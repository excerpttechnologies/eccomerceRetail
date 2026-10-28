import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { getWebConnection } from "@/lib/db";
import { env } from "@/lib/env";
import { OtpModel } from "@/models/web/commerce.models";
import { sendAuthenticationOtp } from "@/lib/whatsapp/client";
import { getWhatsAppConfig, isWhatsAppOtpAvailable } from "@/lib/whatsapp/config";
import { WhatsAppError } from "@/lib/whatsapp/types";

export type OtpChannel = "whatsapp" | "sms";
export type OtpPurpose = "login";

const hash = (mobile: string, code: string, purpose: OtpPurpose) =>
  createHash("sha256").update(`${mobile}:${purpose}:${code}:${env.JWT_SECRET}`).digest("hex");

const safeEqualHex = (a: string, b: string) => {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
};

function otpError(code: string, message: string, status: number, details?: unknown) {
  return Object.assign(new Error(message), { code, status, details });
}

export function hashOtpIp(ip: string | undefined): string | undefined {
  if (!ip?.trim()) return undefined;
  return createHash("sha256").update(`${ip.trim()}:${env.JWT_SECRET}`).digest("hex");
}

export function normaliseMobile(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

/**
 * OTP login is delivered by WhatsApp. The old SMS channel is intentionally disabled:
 * `deliverSms` was a stub that returned success without sending anything, which left
 * customers waiting for a code that never arrived.
 */
export function requireOtpChannel(channel: OtpChannel | undefined): "whatsapp" {
  if (channel === "sms") {
    throw otpError("OTP_CHANNEL_UNAVAILABLE", "SMS OTP is not available. Please use WhatsApp OTP.", 503);
  }
  if (!isWhatsAppOtpAvailable()) {
    throw otpError(
      "WHATSAPP_NOT_CONFIGURED",
      "WhatsApp OTP is not configured yet. Use email and password, or contact support.",
      503,
    );
  }
  return "whatsapp";
}

/**
 * Creates and sends a one-time login code.
 *
 * Security properties:
 *  - cryptographically random 6-digit code, stored only as a salted SHA-256 hash
 *  - configurable expiry (default 1 minute, matching the approved Meta template);
 *    bound to the phone number and purpose
 *  - per-number cooldown + hourly limits, plus a hashed-IP hourly limit
 *  - previous codes are invalidated on resend; successful verification deletes the code
 *  - OTPs are never written to logs; WhatsApp messages never return the code to the browser
 */
export async function sendOtp(
  mobile: string,
  options: { channel?: OtpChannel; ip?: string; purpose?: OtpPurpose } = {},
): Promise<{ expiresInSec: number; channel: "whatsapp" }> {
  const channel = requireOtpChannel(options.channel);
  const purpose = options.purpose ?? "login";
  const config = getWhatsAppConfig();
  const now = new Date();
  const cooldownMs = config.otpResendCooldownSeconds * 1000;
  const hourAgo = new Date(now.getTime() - 60 * 60_000);

  const M = OtpModel(await getWebConnection());

  const latest = await M.findOne({ mobile, purpose }).sort({ sentAt: -1 }).lean<{ sentAt?: Date }>();
  if (latest?.sentAt && now.getTime() - new Date(latest.sentAt).getTime() < cooldownMs) {
    const retryAfter = Math.ceil((cooldownMs - (now.getTime() - new Date(latest.sentAt).getTime())) / 1000);
    throw otpError("OTP_COOLDOWN", `Please wait ${retryAfter}s before requesting another code.`, 429, { retryAfter });
  }

  const mobileCount = await M.countDocuments({ mobile, purpose, sentAt: { $gte: hourAgo } });
  if (mobileCount >= config.otpMaxPerHour) {
    throw otpError("OTP_RATE_LIMITED", "Too many codes requested for this number. Try again later.", 429);
  }

  const ipHash = hashOtpIp(options.ip);
  if (ipHash) {
    const ipCount = await M.countDocuments({ ipHash, sentAt: { $gte: hourAgo } });
    if (ipCount >= Math.max(10, config.otpMaxPerHour * 2)) {
      throw otpError("OTP_RATE_LIMITED", "Too many codes requested. Try again later.", 429);
    }
  }

  const code = String(randomInt(100_000, 1_000_000));
  const expiresInSec = config.otpTtlMinutes * 60;
  const expiresAt = new Date(now.getTime() + expiresInSec * 1000);

  // One active code per number + purpose. Deleting first also invalidates old codes on resend.
  await M.deleteMany({ mobile, purpose });
  const created = await M.create({
    mobile,
    purpose,
    channel,
    codeHash: hash(mobile, code, purpose),
    attempts: 0,
    ipHash,
    sentAt: now,
    expiresAt,
  });

  try {
    const result = await sendAuthenticationOtp(mobile, code);
    await M.updateOne({ _id: created._id }, { $set: { providerMessageId: result.messageId } });
  } catch (error) {
    // Never leave a valid code behind when the provider rejected the send.
    await M.deleteOne({ _id: created._id }).catch(() => undefined);
    if (error instanceof WhatsAppError) {
      throw otpError(error.code, error.message, error.httpStatus && error.httpStatus < 500 ? 422 : 503);
    }
    throw otpError("OTP_SEND_FAILED", "Could not send the code. Please try again.", 503);
  }

  return { expiresInSec, channel };
}

export async function verifyOtp(mobile: string, code: string, purpose: OtpPurpose = "login"): Promise<boolean> {
  const config = getWhatsAppConfig();
  const now = new Date();
  const M = OtpModel(await getWebConnection());
  const doc = await M.findOne({ mobile, purpose, expiresAt: { $gt: now } })
    .sort({ sentAt: -1 })
    .lean<{ _id: unknown; codeHash: string; attempts?: number }>();
  if (!doc) return false;

  if ((doc.attempts ?? 0) >= config.otpMaxAttempts) {
    await M.deleteOne({ _id: doc._id });
    return false;
  }

  if (!safeEqualHex(doc.codeHash, hash(mobile, code, purpose))) {
    // Atomically cap wrong guesses. The final allowed miss removes the code.
    const failed = await M.findOneAndUpdate(
      { _id: doc._id, $or: [{ attempts: { $lt: config.otpMaxAttempts } }, { attempts: { $exists: false } }] },
      { $inc: { attempts: 1 } },
      { new: true },
    ).lean<{ attempts?: number }>();
    if (!failed || (failed.attempts ?? 0) >= config.otpMaxAttempts) {
      await M.deleteOne({ _id: doc._id });
    }
    return false;
  }

  // Atomic delete claims the code, so two concurrent verifications cannot replay it.
  const consumed = await M.findOneAndDelete({ _id: doc._id, codeHash: doc.codeHash });
  if (!consumed) return false;
  await M.deleteMany({ mobile, purpose });
  return true;
}

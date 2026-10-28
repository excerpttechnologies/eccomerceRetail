import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeCollection } from "./helpers/fake-collection";

process.env.JWT_SECRET = "test-secret-at-least-16-chars";
process.env.WHATSAPP_ENABLED = "true";
process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";
process.env.WHATSAPP_OTP_TEMPLATE = "we_otp";
process.env.WHATSAPP_OTP_TTL_MINUTES = "5";
process.env.WHATSAPP_OTP_MAX_ATTEMPTS = "3";
process.env.WHATSAPP_OTP_RESEND_COOLDOWN_SECONDS = "60";
process.env.WHATSAPP_OTP_MAX_PER_HOUR = "1";

const sendMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ getWebConnection: async () => ({}) }));
vi.mock("@/models/web/commerce.models", async () => {
  const { FakeCollection } = await import("./helpers/fake-collection");
  const Otp = new FakeCollection();
  return { OtpModel: () => Otp.model, __fake: { Otp } };
});
vi.mock("@/lib/whatsapp/client", async (orig) => {
  const actual = await orig<typeof import("@/lib/whatsapp/client")>();
  return { ...actual, sendAuthenticationOtp: (...args: unknown[]) => sendMock(...args) };
});

const models = (await import("@/models/web/commerce.models")) as unknown as { __fake: { Otp: FakeCollection } };
const { sendOtp, verifyOtp, normaliseMobile } = await import("@/lib/otp");
const { WhatsAppError } = await import("@/lib/whatsapp/types");

beforeEach(() => {
  models.__fake.Otp.rows.length = 0;
  sendMock.mockReset().mockResolvedValue({ messageId: "wamid.otp.1" });
});

describe("WhatsApp OTP flow", () => {
  it("sends a WhatsApp authentication template, stores only a hash, and verifies once", async () => {
    const result = await sendOtp("9876543210", { channel: "whatsapp", ip: "203.0.113.5" });
    expect(result).toMatchObject({ channel: "whatsapp", expiresInSec: 300 });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const code = sendMock.mock.calls[0][1] as string;
    expect(code).toMatch(/^\d{6}$/);
    const row = models.__fake.Otp.rows[0];
    expect(row.codeHash).not.toBe(code);
    expect(row.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.providerMessageId).toBe("wamid.otp.1");
    expect(row.ipHash).toMatch(/^[a-f0-9]{64}$/);

    expect(await verifyOtp("9876543210", code)).toBe(true);
    expect(models.__fake.Otp.rows).toHaveLength(0);
    expect(await verifyOtp("9876543210", code)).toBe(false);
  });

  it("enforces the resend cooldown", async () => {
    await sendOtp("9876543210", { channel: "whatsapp" });
    await expect(sendOtp("9876543210", { channel: "whatsapp" })).rejects.toMatchObject({
      code: "OTP_COOLDOWN",
      status: 429,
    });
  });

  it("enforces the hourly per-number limit", async () => {
    await sendOtp("9876543210", { channel: "whatsapp" });
    models.__fake.Otp.rows[0].sentAt = new Date(Date.now() - 120_000);
    await expect(sendOtp("9876543210", { channel: "whatsapp" })).rejects.toMatchObject({
      code: "OTP_RATE_LIMITED",
      status: 429,
    });
  });

  it("caps wrong attempts and invalidates the code", async () => {
    await sendOtp("9876543210", { channel: "whatsapp" });
    const correct = sendMock.mock.calls[0][1] as string;
    const wrong = correct === "000000" ? "111111" : "000000";
    expect(await verifyOtp("9876543210", wrong)).toBe(false);
    expect(await verifyOtp("9876543210", wrong)).toBe(false);
    expect(await verifyOtp("9876543210", wrong)).toBe(false);
    expect(models.__fake.Otp.rows).toHaveLength(0);
    expect(await verifyOtp("9876543210", correct)).toBe(false);
  });

  it("rejects expired codes", async () => {
    await sendOtp("9876543210", { channel: "whatsapp" });
    const code = sendMock.mock.calls[0][1] as string;
    models.__fake.Otp.rows[0].expiresAt = new Date(Date.now() - 1000);
    expect(await verifyOtp("9876543210", code)).toBe(false);
  });

  it("deletes the pending code when the provider rejects the send", async () => {
    sendMock.mockRejectedValueOnce(new WhatsAppError("WHATSAPP_PROVIDER_ERROR", "template rejected", { retryable: false, httpStatus: 400 }));
    await expect(sendOtp("9876543210", { channel: "whatsapp" })).rejects.toMatchObject({
      code: "WHATSAPP_PROVIDER_ERROR",
      status: 422,
    });
    expect(models.__fake.Otp.rows).toHaveLength(0);
  });

  it("defaults to WhatsApp when no channel is supplied", async () => {
    const result = await sendOtp("9876543210");
    expect(result.channel).toBe("whatsapp");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("rejects the unimplemented SMS channel instead of silently succeeding", async () => {
    await expect(sendOtp("9876543210", { channel: "sms" })).rejects.toMatchObject({
      code: "OTP_CHANNEL_UNAVAILABLE",
      status: 503,
    });
    expect(sendMock).not.toHaveBeenCalled();
    expect(models.__fake.Otp.rows).toHaveLength(0);
  });

  it("normalises Indian mobile numbers", () => {
    expect(normaliseMobile("+91 98765 43210")).toBe("9876543210");
    expect(normaliseMobile("12345")).toBeNull();
  });
});

import type { NextRequest } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/api/body";
import { fail, handler, ok } from "@/lib/api/response";
import { normaliseMobile, sendOtp } from "@/lib/otp";

export const dynamic = "force-dynamic";

export const POST = handler(async (req: NextRequest) => {
  const b = await parseBody(req, z.object({ mobile: z.string(), channel: z.enum(["whatsapp", "sms"]).optional() }));
  if (!b.ok) return b.res;
  const mobile = normaliseMobile(b.data.mobile);
  if (!mobile) return fail("VALIDATION_ERROR", "Enter a valid Indian mobile number", 422);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || undefined;
  return ok({ mobile, ...(await sendOtp(mobile, { channel: b.data.channel, ip })) });
});

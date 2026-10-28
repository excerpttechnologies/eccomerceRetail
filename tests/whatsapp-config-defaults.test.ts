import { describe, expect, it } from "vitest";

process.env.JWT_SECRET = "test-secret-at-least-16-chars";
delete process.env.WHATSAPP_OTP_INCLUDE_BUTTON;
process.env.WHATSAPP_ENABLED = "true";
process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";
process.env.WHATSAPP_OTP_TEMPLATE = "we_otp";

const { getWhatsAppConfig } = await import("@/lib/whatsapp/config");

describe("WhatsApp configuration defaults", () => {
  it("defaults the OTP copy-code button on when the optional variable is omitted", () => {
    expect(getWhatsAppConfig().otpIncludeButton).toBe(true);
  });
});

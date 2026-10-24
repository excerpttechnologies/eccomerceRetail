import { describe, expect, it } from "vitest";

process.env.JWT_SECRET = "test-secret-at-least-16-chars";
process.env.WHATSAPP_ENABLED = "false";
process.env.WHATSAPP_ACCESS_TOKEN = "";
process.env.WHATSAPP_PHONE_NUMBER_ID = "";
process.env.WHATSAPP_OTP_TEMPLATE = "";
process.env.WHATSAPP_ORDER_CONFIRMATION_TEMPLATE = "";

const { sendUtilityTemplate } = await import("@/lib/whatsapp/client");
const { whatsappConfigStatus } = await import("@/lib/whatsapp/config");
const { enqueueOrderNotification } = await import("@/lib/whatsapp/notifications");
const { sendOtp } = await import("@/lib/otp");

describe("WhatsApp disabled / missing configuration", () => {
  it("fails closed for direct sends instead of bypassing or claiming success", async () => {
    await expect(sendUtilityTemplate("order_confirmation", "9876543210", ["a"])).rejects.toMatchObject({
      code: "WHATSAPP_DISABLED",
      retryable: false,
    });
  });

  it("reports safe diagnostics and missing variable names", () => {
    const status = whatsappConfigStatus();
    expect(status.enabled).toBe(false);
    expect(status.sendConfigured).toBe(false);
    expect(status.missing).toContain("WHATSAPP_ACCESS_TOKEN");
    expect(status.missing).toContain("WHATSAPP_OTP_TEMPLATE");
    expect(JSON.stringify(status)).not.toContain("Bearer");
  });

  it("does not throw into checkout when disabled", async () => {
    await expect(
      enqueueOrderNotification({ orderNo: "WE-1", shippingAddress: { phone: "9876543210" } } as never, "order_confirmation"),
    ).resolves.toBeNull();
  });

  it("does not fall back to an insecure OTP channel when WhatsApp OTP is requested but unconfigured", async () => {
    await expect(sendOtp("9876543210", { channel: "whatsapp" })).rejects.toMatchObject({
      code: "WHATSAPP_NOT_CONFIGURED",
      status: 503,
    });
  });
});

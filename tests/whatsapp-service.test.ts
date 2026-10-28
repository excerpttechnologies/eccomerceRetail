import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET = "test-secret-at-least-16-chars";
process.env.NEXT_PUBLIC_SITE_URL = "https://wovenessence.test";
process.env.WHATSAPP_ENABLED = "true";
process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";
process.env.WHATSAPP_APP_SECRET = "test-app-secret";
process.env.WHATSAPP_VERIFY_TOKEN = "test-verify-token";
process.env.WHATSAPP_API_VERSION = "v26.0";
process.env.WHATSAPP_TEMPLATE_LANGUAGE = "en";
process.env.WHATSAPP_OTP_TEMPLATE = "we_otp";
process.env.WHATSAPP_OTP_INCLUDE_BUTTON = "true";
process.env.WHATSAPP_OTP_BODY_PARAMS = "2";
process.env.WHATSAPP_ORDER_CONFIRMATION_TEMPLATE = "we_order_confirmed";
process.env.WHATSAPP_ORDER_SHIPPED_TEMPLATE = "we_order_shipped";
process.env.WHATSAPP_ORDER_DELIVERED_TEMPLATE = "we_order_delivered";
process.env.WHATSAPP_TEST_TEMPLATE = "we_test";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const {
  normaliseWhatsAppNumber,
  sendAuthenticationOtp,
  sendUtilityTemplate,
  verifyWebhookSignature,
} = await import("@/lib/whatsapp/client");
const { WhatsAppError } = await import("@/lib/whatsapp/types");
const { orderConfirmationParams, shippingParams, deliveryParams } = await import("@/lib/whatsapp/templates");
const { createOrderTrackingToken, verifyOrderTrackingToken, orderTrackingUrl } = await import("@/lib/whatsapp/tracking");
const { parseStatusEvents } = await import("@/lib/whatsapp/webhook");
const { whatsappConfigStatus } = await import("@/lib/whatsapp/config");

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const success = { messages: [{ id: "wamid.test.1" }], contacts: [{ input: "919876543210", wa_id: "919876543210" }] };

const order = {
  orderNo: "WE-2026-0001",
  customerId: "customer-1",
  items: [{ sku: "SKU1", name: "Kanjivaram Silk", qty: 2, rate: 5000, amount: 10000 }],
  subTotal: 10000,
  discountTotal: 0,
  gstTotal: 0,
  shippingCharge: 0,
  netAmount: 10000,
  paymentMode: "COD",
  paymentStatus: "Pending",
  orderStatus: "Placed",
  shippingAddress: { name: "Asha Rao", phone: "9876543210", line1: "12 Temple Street", city: "Bengaluru", state: "Karnataka", pincode: "560001", country: "India" },
  awbNo: "AWB123",
  courierName: "Delhivery",
} as never;

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(response(success));
});

describe("Meta WhatsApp Cloud API client", () => {
  it("normalises a 10-digit Indian number to Meta's digits-only E.164 format", () => {
    expect(normaliseWhatsAppNumber("98765 43210")).toBe("919876543210");
    expect(normaliseWhatsAppNumber("+91 98765 43210")).toBe("919876543210");
    expect(() => normaliseWhatsAppNumber("123")).toThrow(WhatsAppError);
  });

  it("sends an authentication template with the code in body and copy-code button", async () => {
    const result = await sendAuthenticationOtp("9876543210", "123456");
    expect(result.messageId).toBe("wamid.test.1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://graph.facebook.com/v26.0/1234567890/messages");
    expect(init.headers.Authorization).toBe("Bearer test-access-token");
    const payload = JSON.parse(init.body);
    expect(payload).toMatchObject({
      messaging_product: "whatsapp",
      to: "919876543210",
      type: "template",
      template: { name: "we_otp", language: { code: "en" } },
    });
    expect(payload.template.components).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", text: "123456" },
          { type: "text", text: "Login" },
        ],
      },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "123456" }] },
    ]);
  });

  it("sends utility templates with the documented positional order", async () => {
    await sendUtilityTemplate("order_confirmation", "9876543210", ["Asha", "WE-1", "Saree x 1", "INR 100", "Bengaluru", "https://x"]);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.template.name).toBe("we_order_confirmed");
    expect(payload.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual([
      "Asha",
      "WE-1",
      "Saree x 1",
      "INR 100",
      "Bengaluru",
      "https://x",
    ]);
  });

  it("marks Meta rate limits and server errors retryable, but validation errors permanent", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: { message: "Rate limit", code: 130429 } }, 429));
    await expect(sendUtilityTemplate("order_confirmation", "9876543210", ["a"])).rejects.toMatchObject({
      code: "WHATSAPP_PROVIDER_ERROR",
      retryable: true,
      httpStatus: 429,
      providerCode: 130429,
    });

    fetchMock.mockResolvedValueOnce(response({ error: { message: "Bad template", code: 132000 } }, 400));
    await expect(sendUtilityTemplate("order_confirmation", "9876543210", ["a"])).rejects.toMatchObject({
      retryable: false,
      httpStatus: 400,
      providerCode: 132000,
    });
  });

  it("handles network timeouts as retryable without leaking request or token data", async () => {
    fetchMock.mockRejectedValueOnce(new Error("socket timeout"));
    await expect(sendAuthenticationOtp("9876543210", "654321")).rejects.toMatchObject({
      code: "WHATSAPP_NETWORK_ERROR",
      retryable: true,
    });
  });

  it("verifies X-Hub-Signature-256 with the raw body and rejects tampering", () => {
    const raw = JSON.stringify({ object: "whatsapp_business_account" });
    const signature = createHmac("sha256", "test-app-secret").update(raw, "utf8").digest("hex");
    expect(verifyWebhookSignature(raw, `sha256=${signature}`, "test-app-secret")).toBe(true);
    expect(verifyWebhookSignature(`${raw} `, `sha256=${signature}`, "test-app-secret")).toBe(false);
    expect(verifyWebhookSignature(raw, "sha256=deadbeef", "test-app-secret")).toBe(false);
    expect(verifyWebhookSignature(raw, null, "test-app-secret")).toBe(false);
  });

  it("builds the order, shipped and delivered parameter lists from authoritative order data", async () => {
    const confirmation = await orderConfirmationParams(order);
    expect(confirmation.slice(0, 5)).toEqual([
      "Asha Rao",
      "WE-2026-0001",
      "Kanjivaram Silk x 2",
      "₹10,000",
      "12 Temple Street, Bengaluru, Karnataka, 560001",
    ]);
    expect(confirmation[5]).toMatch(/^https:\/\/wovenessence\.test\/track-order\?token=/);
    expect(await shippingParams(order)).toEqual([
      "Asha Rao",
      "WE-2026-0001",
      "Delhivery",
      "AWB123",
      expect.stringMatching(/\/track-order\?token=/),
    ]);
    expect((await deliveryParams(order)).slice(0, 2)).toEqual(["Asha Rao", "WE-2026-0001"]);
  });

  it("creates order-scoped tracking tokens and rejects tampering", async () => {
    const token = await createOrderTrackingToken("WE-2026-0001");
    expect(await verifyOrderTrackingToken(token)).toBe("WE-2026-0001");
    expect(await verifyOrderTrackingToken(`${token}x`)).toBeNull();
    expect(await verifyOrderTrackingToken(undefined)).toBeNull();
    expect(await orderTrackingUrl("WE-2026-0001")).toContain("/track-order?token=");
  });

  it("parses only outbound status events and ignores inbound customer messages", () => {
    const events = parseStatusEvents({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: "wamid.1", status: "delivered", timestamp: "1700000000", recipient_id: "91987" },
                  { id: "wamid.2", status: "read", timestamp: "1700000001" },
                ],
                messages: [{ id: "inbound" }],
              },
            },
          ],
        },
      ],
    });
    expect(events.map((e) => `${e.messageId}:${e.status}`)).toEqual(["wamid.1:delivered", "wamid.2:read"]);
  });

  it("reports configuration without exposing secret values", () => {
    const status = whatsappConfigStatus();
    expect(status.enabled).toBe(true);
    expect(status.sendConfigured).toBe(true);
    expect(status.webhookConfigured).toBe(true);
    expect(status.apiVersion).toBe("v26.0");
    expect(status.missing).toEqual([]);
    expect(JSON.stringify(status)).not.toContain("test-access-token");
    expect(JSON.stringify(status)).not.toContain("test-app-secret");
  });
});

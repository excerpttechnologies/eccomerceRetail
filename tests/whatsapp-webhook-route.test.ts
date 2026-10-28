import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.WHATSAPP_ENABLED = "true";
process.env.WHATSAPP_VERIFY_TOKEN = "test-verify-token";
process.env.WHATSAPP_APP_SECRET = "test-app-secret";

const processMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/whatsapp/webhook", () => ({
  processDeliveryStatusWebhook: (...args: unknown[]) => processMock(...args),
}));

const { GET, POST } = await import("@/app/api/v1/webhooks/whatsapp/route");
const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
const signature = createHmac("sha256", "test-app-secret").update(raw, "utf8").digest("hex");

const get = (query = "") => new Request(`http://localhost/api/v1/webhooks/whatsapp${query}`) as never;
const post = (body = raw, sig = `sha256=${signature}`) =>
  new Request("http://localhost/api/v1/webhooks/whatsapp", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "x-hub-signature-256": sig },
  }) as never;

beforeEach(() => {
  processMock.mockReset().mockResolvedValue({ received: 0, updated: 0, duplicates: 0, unmatched: 0 });
});

describe("WhatsApp webhook route", () => {
  it("completes Meta's GET verification with the configured token", async () => {
    const response = await GET(get("?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=12345"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("12345");
  });

  it("rejects the GET verification when the token is wrong", async () => {
    const response = await GET(get("?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345"));
    expect(response.status).toBe(403);
  });

  it("rejects invalid X-Hub-Signature-256 values before parsing", async () => {
    const response = await POST(post(raw, "sha256=deadbeef"));
    expect(response.status).toBe(401);
    expect(processMock).not.toHaveBeenCalled();
  });

  it("accepts a correctly signed payload and processes it", async () => {
    const response = await POST(post());
    expect(response.status).toBe(200);
    expect(processMock).toHaveBeenCalledTimes(1);
    expect(processMock.mock.calls[0][0]).toMatchObject({ object: "whatsapp_business_account" });
  });

  it("acknowledges validly signed unrelated webhooks without processing them", async () => {
    const other = JSON.stringify({ object: "page", entry: [] });
    const otherSig = createHmac("sha256", "test-app-secret").update(other, "utf8").digest("hex");
    const response = await POST(post(other, `sha256=${otherSig}`));
    expect(response.status).toBe(200);
    expect(processMock).not.toHaveBeenCalled();
  });
});

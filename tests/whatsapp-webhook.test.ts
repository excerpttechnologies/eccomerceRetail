import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeCollection } from "./helpers/fake-collection";

process.env.WHATSAPP_ENABLED = "true";
process.env.WHATSAPP_VERIFY_TOKEN = "test-verify-token";
process.env.WHATSAPP_APP_SECRET = "test-app-secret";

vi.mock("@/lib/db", () => ({ getWebConnection: async () => ({}) }));
vi.mock("@/models/web/notification.models", async () => {
  const { FakeCollection } = await import("./helpers/fake-collection");
  const Notifications = new FakeCollection();
  const Webhooks = new FakeCollection();
  return {
    WhatsAppNotificationModel: () => Notifications.model,
    WhatsAppWebhookEventModel: () => Webhooks.model,
    __fake: { Notifications, Webhooks },
  };
});

const models = (await import("@/models/web/notification.models")) as unknown as {
  __fake: { Notifications: FakeCollection; Webhooks: FakeCollection };
};
const { processDeliveryStatusWebhook } = await import("@/lib/whatsapp/webhook");

const payload = (status: string, messageId = "wamid.1", timestamp = "1700000000") => ({
  object: "whatsapp_business_account",
  entry: [{ changes: [{ value: { statuses: [{ id: messageId, status, timestamp, recipient_id: "919876543210" }] } }] }],
});

beforeEach(() => {
  models.__fake.Notifications.rows.length = 0;
  models.__fake.Webhooks.rows.length = 0;
  models.__fake.Notifications.rows.push({
    _id: "64b000000000000000000001",
    providerMessageId: "wamid.1",
    status: "sent",
    providerStatus: "sent",
  });
});

describe("WhatsApp delivery-status webhook", () => {
  it("updates notification delivery status but never touches an order", async () => {
    const result = await processDeliveryStatusWebhook(payload("delivered"));
    expect(result).toMatchObject({ received: 1, updated: 1, duplicates: 0, unmatched: 0 });
    expect(models.__fake.Notifications.rows[0]).toMatchObject({
      status: "delivered",
      providerStatus: "delivered",
    });
    expect(models.__fake.Notifications.rows[0].deliveredAt).toBeInstanceOf(Date);
  });

  it("ignores duplicate events safely", async () => {
    await processDeliveryStatusWebhook(payload("delivered"));
    const duplicate = await processDeliveryStatusWebhook(payload("delivered"));
    expect(duplicate).toMatchObject({ received: 1, updated: 0, duplicates: 1 });
    expect(models.__fake.Webhooks.rows).toHaveLength(1);
  });

  it("does not downgrade a delivered message on a late failed event", async () => {
    await processDeliveryStatusWebhook(payload("delivered"));
    const failed = await processDeliveryStatusWebhook(payload("failed", "wamid.1", "1700000001"));
    expect(failed.updated).toBe(0);
    expect(models.__fake.Notifications.rows[0].status).toBe("delivered");
  });

  it("updates sent → delivered → read monotonically", async () => {
    await processDeliveryStatusWebhook(payload("delivered", "wamid.1", "1700000000"));
    const read = await processDeliveryStatusWebhook(payload("read", "wamid.1", "1700000001"));
    expect(read.updated).toBe(1);
    expect(models.__fake.Notifications.rows[0]).toMatchObject({ status: "read", providerStatus: "read" });
    expect(models.__fake.Notifications.rows[0].readAt).toBeInstanceOf(Date);
  });

  it("acknowledges but ignores events for messages that are not in the outbox", async () => {
    const result = await processDeliveryStatusWebhook(payload("delivered", "wamid.unknown"));
    expect(result).toMatchObject({ received: 1, updated: 0, unmatched: 1 });
    expect(models.__fake.Notifications.rows[0].status).toBe("sent");
  });
});

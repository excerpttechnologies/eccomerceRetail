import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@/domain/types";
import type { FakeCollection } from "./helpers/fake-collection";

process.env.JWT_SECRET = "test-secret-at-least-16-chars";
process.env.NEXT_PUBLIC_SITE_URL = "https://wovenessence.test";
process.env.WHATSAPP_ENABLED = "true";
process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";
process.env.WHATSAPP_APP_SECRET = "test-app-secret";
process.env.WHATSAPP_VERIFY_TOKEN = "test-verify-token";
process.env.WHATSAPP_TEMPLATE_LANGUAGE = "en";
process.env.WHATSAPP_ORDER_CONFIRMATION_TEMPLATE = "we_order_confirmed";
process.env.WHATSAPP_ORDER_SHIPPED_TEMPLATE = "we_order_shipped";
process.env.WHATSAPP_ORDER_DELIVERED_TEMPLATE = "we_order_delivered";
process.env.WHATSAPP_TEST_TEMPLATE = "we_test";
process.env.WHATSAPP_MAX_ATTEMPTS = "3";

const orders = vi.hoisted(() => new Map<string, Order>());
const sendMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  getWebConnection: async () => ({}),
  isValidObjectId: (id: string) => /^[a-f\d]{24}$/i.test(id),
  toObjectIdOrString: (id: string) => id,
}));
vi.mock("@/repositories", () => ({
  getOrders: () => ({ getByOrderNo: async (orderNo: string) => orders.get(orderNo) ?? null }),
}));
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
vi.mock("@/lib/whatsapp/client", async (orig) => {
  const actual = await orig<typeof import("@/lib/whatsapp/client")>();
  return { ...actual, sendUtilityTemplate: (...args: unknown[]) => sendMock(...args) };
});

const models = (await import("@/models/web/notification.models")) as unknown as {
  __fake: { Notifications: FakeCollection; Webhooks: FakeCollection };
};
const {
  enqueueOrderNotification,
  enqueueNotificationsForStatus,
  deliverNotification,
  retryNotification,
  sendTestMessage,
  listNotifications,
  processDueNotifications,
} = await import("@/lib/whatsapp/notifications");
const { WhatsAppError } = await import("@/lib/whatsapp/types");

const baseOrder = (overrides: Partial<Order> = {}): Order => ({
  id: "customer-1",
  orderNo: "WE-2026-0001",
  customerId: "customer-1",
  items: [{ sku: "SKU1", name: "Kanjivaram Silk", qty: 2, rate: 5000, discount: 0, gst: 0, amount: 10000 }],
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
  ...overrides,
});

beforeEach(() => {
  models.__fake.Notifications.rows.length = 0;
  models.__fake.Webhooks.rows.length = 0;
  orders.clear();
  sendMock.mockReset().mockResolvedValue({ messageId: "wamid.outbox.1" });
});

describe("WhatsApp durable notification outbox", () => {
  it("creates one idempotent outbox row per order event", async () => {
    const order = baseOrder();
    const first = await enqueueOrderNotification(order, "order_confirmation");
    const second = await enqueueOrderNotification(order, "order_confirmation");
    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(models.__fake.Notifications.rows).toHaveLength(1);
    expect(models.__fake.Notifications.rows[0]).toMatchObject({
      idempotencyKey: "order_confirmation:WE-2026-0001",
      recipient: "919876543210",
      recipientMasked: "********3210",
      status: "queued",
      type: "order_confirmation",
      templateName: "we_order_confirmed",
    });
  });

  it("never queues a shipping message without an AWB", async () => {
    const id = await enqueueOrderNotification(baseOrder({ awbNo: undefined }), "order_shipped");
    expect(id).toBeNull();
    expect(models.__fake.Notifications.rows).toHaveLength(0);
  });

  it("maps confirmed, shipped and delivered transitions to the correct templates", async () => {
    orders.set("WE-2026-0001", baseOrder({ orderStatus: "Confirmed" }));
    expect(await enqueueNotificationsForStatus(baseOrder({ orderStatus: "Confirmed" }), "Placed")).toHaveLength(1);
    orders.set("WE-2026-0001", baseOrder({ orderStatus: "Shipped" }));
    expect(await enqueueNotificationsForStatus(baseOrder({ orderStatus: "Shipped" }), "Packed")).toHaveLength(1);
    orders.set("WE-2026-0001", baseOrder({ orderStatus: "Delivered" }));
    expect(await enqueueNotificationsForStatus(baseOrder({ orderStatus: "Delivered" }), "Shipped")).toHaveLength(1);
    expect(models.__fake.Notifications.rows.map((row) => row.type)).toEqual([
      "order_confirmation",
      "order_shipped",
      "order_delivered",
    ]);
  });

  it("sends once, stores the provider message id and skips duplicate delivery", async () => {
    orders.set("WE-2026-0001", baseOrder());
    const id = (await enqueueOrderNotification(baseOrder(), "order_confirmation"))!;
    const first = await deliverNotification(id);
    expect(first).toMatchObject({ status: "sent", providerMessageId: "wamid.outbox.1" });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(models.__fake.Notifications.rows[0].status).toBe("sent");
    expect(models.__fake.Notifications.rows[0].providerMessageId).toBe("wamid.outbox.1");

    const second = await deliverNotification(id);
    expect(second.status).toBe("skipped");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("retries transient provider failures with backoff instead of losing the event", async () => {
    orders.set("WE-2026-0001", baseOrder());
    const id = (await enqueueOrderNotification(baseOrder(), "order_confirmation"))!;
    sendMock.mockRejectedValueOnce(new WhatsAppError("WHATSAPP_NETWORK_ERROR", "timeout", { retryable: true }));
    const failed = await deliverNotification(id);
    expect(failed.status).toBe("queued");
    const row = models.__fake.Notifications.rows[0];
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(1);
    expect(new Date(row.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());

    const retried = await retryNotification(id);
    expect(retried.status).toBe("sent");
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("skips confirmation for a cancelled order and never changes the order", async () => {
    const cancelled = baseOrder({ orderStatus: "Cancelled" });
    orders.set(cancelled.orderNo, cancelled);
    const id = (await enqueueOrderNotification(baseOrder(), "order_confirmation"))!;
    const result = await deliverNotification(id);
    expect(result.status).toBe("skipped");
    expect(sendMock).not.toHaveBeenCalled();
    expect(models.__fake.Notifications.rows[0].status).toBe("skipped");
    expect(orders.get(cancelled.orderNo)?.orderStatus).toBe("Cancelled");
  });

  it("sends an admin test through the test template only", async () => {
    const result = await sendTestMessage({ to: "9876543210", text: "hello", actor: "admin@example.com" });
    expect(result.status).toBe("sent");
    expect(sendMock).toHaveBeenCalledWith("test", "919876543210", ["hello"]);
    expect(models.__fake.Notifications.rows[0]).toMatchObject({ type: "test", recipientMasked: "********3210" });
  });

  it("lists history with masked recipients and filters by order/status", async () => {
    orders.set("WE-2026-0001", baseOrder());
    await enqueueOrderNotification(baseOrder(), "order_confirmation");
    const listed = await listNotifications({ page: 1, limit: 10, status: "queued", orderNo: "WE-2026-0001" });
    expect(listed.total).toBe(1);
    expect(listed.items[0].recipient).toBe("********3210");
    expect(listed.items[0].orderNo).toBe("WE-2026-0001");
  });

  it("does not auto-retry permanent failures forever", async () => {
    orders.set("WE-2026-0001", baseOrder());
    await enqueueOrderNotification(baseOrder(), "order_confirmation");
    models.__fake.Notifications.rows.push({
      _id: "64b000000000000000000099",
      idempotencyKey: "order_confirmation:WE-OLD",
      orderNo: "WE-OLD",
      type: "order_confirmation",
      templateName: "we_order_confirmed",
      recipient: "919876543210",
      recipientMasked: "********3210",
      status: "failed",
      attempts: 3,
    });
    const result = await processDueNotifications(10);
    expect(result).toMatchObject({ processed: 1, sent: 1 });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(models.__fake.Notifications.rows.find((row) => row.orderNo === "WE-OLD")?.status).toBe("failed");
  });

  it("recovers a row left in sending by an interrupted process", async () => {
    orders.set("WE-2026-0001", baseOrder());
    models.__fake.Notifications.rows.push({
      _id: "64b000000000000000000098",
      idempotencyKey: "order_confirmation:WE-2026-0001",
      orderNo: "WE-2026-0001",
      type: "order_confirmation",
      templateName: "we_order_confirmed",
      recipient: "919876543210",
      recipientMasked: "********3210",
      status: "sending",
      attempts: 1,
      lastAttemptAt: new Date(Date.now() - 20 * 60_000),
    });
    const result = await processDueNotifications(10);
    expect(result).toMatchObject({ processed: 1, sent: 1 });
    expect(models.__fake.Notifications.rows[0].status).toBe("sent");
  });
});

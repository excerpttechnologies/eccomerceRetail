import { randomUUID } from "node:crypto";
import type { Order } from "@/domain/types";
import { getWebConnection, isValidObjectId, toObjectIdOrString } from "@/lib/db";
import { WhatsAppNotificationModel } from "@/models/web/notification.models";
import type { AnyDoc } from "@/models/_util";
import { getOrders } from "@/repositories";
import { getWhatsAppConfig, isWhatsAppSendConfigured, requireWhatsAppSend, whatsappConfigStatus } from "./config";
import { maskPhone, normaliseWhatsAppNumber, sendUtilityTemplate, whatsAppErrorSummary } from "./client";
import { orderConfirmationParams, deliveryParams, shippingParams } from "./templates";
import { WhatsAppError, type WhatsAppNotificationStatus } from "./types";

export type OrderNotificationType = "order_confirmation" | "order_shipped" | "order_delivered";

export interface NotificationView {
  id: string;
  orderNo?: string;
  type: string;
  templateName: string;
  recipient: string;
  status: WhatsAppNotificationStatus;
  attempts: number;
  lastError?: string;
  providerMessageId?: string;
  providerStatus?: string;
  createdAt?: string;
  updatedAt?: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  nextAttemptAt?: string;
}

const DATE_FIELDS = ["createdAt", "updatedAt", "sentAt", "deliveredAt", "readAt", "lastAttemptAt", "nextAttemptAt", "providerStatusAt"];

function view(doc: AnyDoc): NotificationView {
  const out: NotificationView = {
    id: String(doc._id),
    orderNo: doc.orderNo ?? undefined,
    type: String(doc.type),
    templateName: String(doc.templateName),
    recipient: String(doc.recipientMasked ?? maskPhone(String(doc.recipient ?? ""))),
    status: doc.status as WhatsAppNotificationStatus,
    attempts: Number(doc.attempts ?? 0),
    lastError: doc.lastError ?? undefined,
    providerMessageId: doc.providerMessageId ?? undefined,
    providerStatus: doc.providerStatus ?? undefined,
    nextAttemptAt: doc.nextAttemptAt ? new Date(doc.nextAttemptAt).toISOString() : undefined,
  };
  for (const key of DATE_FIELDS) {
    if (doc[key]) (out as unknown as Record<string, unknown>)[key] = new Date(doc[key]).toISOString();
  }
  return out;
}

/**
 * Persist an outbox row for an order event. This never throws into checkout/admin flows:
 * a notification problem must never invalidate or delay a valid order.
 */
export async function enqueueOrderNotification(
  order: Order,
  type: OrderNotificationType,
): Promise<string | null> {
  try {
    const config = getWhatsAppConfig();
    if (!config.enabled) return null;

    // Shipped notifications are meaningless without the courier tracking number.
    if (type === "order_shipped" && !order.awbNo?.trim()) {
      console.warn("[whatsapp] skipped shipping notification: order has no AWB", { orderNo: order.orderNo });
      return null;
    }

    if (!isWhatsAppSendConfigured(type)) {
      console.warn("[whatsapp] skipped notification: integration or template is not configured", {
        orderNo: order.orderNo,
        type,
      });
      return null;
    }

    const phone = order.shippingAddress.phone;
    if (!phone) {
      console.warn("[whatsapp] skipped notification: order has no phone", { orderNo: order.orderNo, type });
      return null;
    }
    const to = normaliseWhatsAppNumber(phone);
    const templateName = config.templates[type]!;
    const M = WhatsAppNotificationModel(await getWebConnection());
    const doc = await M.findOneAndUpdate(
      { idempotencyKey: `${type}:${order.orderNo}` },
      {
        $setOnInsert: {
          idempotencyKey: `${type}:${order.orderNo}`,
          orderNo: order.orderNo,
          customerId: toObjectIdOrString(order.customerId),
          type,
          templateName,
          recipient: to,
          recipientMasked: maskPhone(to),
          status: "queued",
          attempts: 0,
          nextAttemptAt: new Date(),
          trackingNumber: order.awbNo,
        },
      },
      { upsert: true, new: true },
    ).lean<AnyDoc>();
    return doc ? String(doc._id) : null;
  } catch (error) {
    console.error("[whatsapp] could not enqueue notification", {
      orderNo: order.orderNo,
      type,
      error: whatsAppErrorSummary(error),
    });
    return null;
  }
}

/** Queue the lifecycle notifications that the existing order workflow supports. */
export async function enqueueNotificationsForStatus(
  order: Order,
  previousStatus: Order["orderStatus"],
): Promise<string[]> {
  const ids: string[] = [];
  const status = order.orderStatus;

  // Confirmation: COD is accepted at checkout; prepaid is confirmed after signature
  // verification. The idempotency key prevents a second message when an admin later
  // moves the order from Placed to Confirmed.
  if (status === "Confirmed" && previousStatus !== "Confirmed") {
    const id = await enqueueOrderNotification(order, "order_confirmation");
    if (id) ids.push(id);
  }
  if (status === "Shipped" && previousStatus !== "Shipped") {
    const id = await enqueueOrderNotification(order, "order_shipped");
    if (id) ids.push(id);
  }
  if (status === "Delivered" && previousStatus !== "Delivered") {
    const id = await enqueueOrderNotification(order, "order_delivered");
    if (id) ids.push(id);
  }
  return ids;
}

type DeliveryResult = { status: "sent" | "queued" | "failed" | "skipped"; providerMessageId?: string; error?: string };

/**
 * Claim one queued row and send it. Claiming is atomic, so concurrent `after()`
 * callbacks, cron runs and manual retries cannot send the same event twice.
 */
export async function deliverNotification(id: string): Promise<DeliveryResult> {
  if (!isValidObjectId(id)) return { status: "skipped", error: "Invalid notification id" };
  const M = WhatsAppNotificationModel(await getWebConnection());
  const now = new Date();
  const claimed = await M.findOneAndUpdate(
    {
      _id: toObjectIdOrString(id),
      status: { $in: ["queued", "failed"] },
      $or: [{ nextAttemptAt: { $lte: now } }, { nextAttemptAt: { $exists: false } }],
    },
    { $set: { status: "sending", lastAttemptAt: now }, $inc: { attempts: 1 } },
    { new: true },
  ).lean<AnyDoc>();
  if (!claimed) return { status: "skipped", error: "Notification is not due or is already being sent" };

  const notificationId = String(claimed._id);
  const type = claimed.type as "order_confirmation" | "order_shipped" | "order_delivered" | "test";
  const attempts = Number(claimed.attempts ?? 1);

  try {
    let providerMessageId: string;
    if (type === "test") {
      providerMessageId = (await sendUtilityTemplate("test", claimed.recipient, [claimed.testText ?? "Woven Essence WhatsApp test message."])).messageId;
    } else {
      if (!claimed.orderNo) throw new WhatsAppError("WHATSAPP_ORDER_MISSING", "Notification has no order reference.");
      const order = await getOrders().getByOrderNo(claimed.orderNo);
      if (!order) throw new WhatsAppError("WHATSAPP_ORDER_MISSING", "Order no longer exists.", { retryable: false });

      if (type === "order_confirmation") {
        if (order.orderStatus === "Cancelled" || order.orderStatus === "Returned" || order.paymentStatus === "Failed") {
          await M.updateOne({ _id: notificationId }, { $set: { status: "skipped", lastError: "Order is no longer confirmable" } });
          return { status: "skipped", error: "Order is no longer confirmable" };
        }
        providerMessageId = (await sendUtilityTemplate("order_confirmation", claimed.recipient, await orderConfirmationParams(order))).messageId;
      } else if (type === "order_shipped") {
        if (order.orderStatus !== "Shipped" && order.orderStatus !== "Delivered") {
          await M.updateOne({ _id: notificationId }, { $set: { status: "skipped", lastError: "Order is not shipped" } });
          return { status: "skipped", error: "Order is not shipped" };
        }
        providerMessageId = (await sendUtilityTemplate("order_shipped", claimed.recipient, await shippingParams(order))).messageId;
      } else {
        if (order.orderStatus !== "Delivered") {
          await M.updateOne({ _id: notificationId }, { $set: { status: "skipped", lastError: "Order is not delivered" } });
          return { status: "skipped", error: "Order is not delivered" };
        }
        providerMessageId = (await sendUtilityTemplate("order_delivered", claimed.recipient, await deliveryParams(order))).messageId;
      }
    }

    await M.updateOne(
      { _id: notificationId },
      {
        $set: {
          status: "sent",
          providerMessageId,
          providerStatus: "accepted",
          providerStatusAt: new Date(),
          sentAt: new Date(),
        },
        $unset: { lastError: 1 },
      },
    );
    return { status: "sent", providerMessageId };
  } catch (error) {
    const config = getWhatsAppConfig();
    const permanent = error instanceof WhatsAppError ? !error.retryable || error.code === "WHATSAPP_DISABLED" || error.code === "WHATSAPP_NOT_CONFIGURED" || error.code === "WHATSAPP_TEMPLATE_MISSING" : false;
    const shouldRetry = !permanent && attempts < config.maxAttempts;
    const nextAttemptAt = shouldRetry ? new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000) : undefined;
    const skip = error instanceof WhatsAppError && error.code === "WHATSAPP_DISABLED";
    await M.updateOne(
      { _id: notificationId },
      {
        $set: {
          status: skip ? "skipped" : shouldRetry ? "queued" : "failed",
          lastError: whatsAppErrorSummary(error),
          ...(nextAttemptAt ? { nextAttemptAt } : {}),
        },
      },
    ).catch(() => undefined);
    console.warn("[whatsapp] notification delivery failed", {
      notificationId,
      attempts,
      retryable: shouldRetry,
      error: whatsAppErrorSummary(error),
    });
    return { status: skip ? "skipped" : shouldRetry ? "queued" : "failed", error: whatsAppErrorSummary(error) };
  }
}

export async function retryNotification(id: string): Promise<DeliveryResult> {
  if (!isValidObjectId(id)) return { status: "skipped", error: "Invalid notification id" };
  const M = WhatsAppNotificationModel(await getWebConnection());
  const doc = await M.findOneAndUpdate(
    { _id: toObjectIdOrString(id), status: { $in: ["failed", "queued", "skipped"] } },
    { $set: { status: "queued", nextAttemptAt: new Date(), attempts: 0 }, $unset: { lastError: 1 } },
    { new: true },
  ).lean<AnyDoc>();
  if (!doc) return { status: "skipped", error: "Notification cannot be retried" };
  return deliverNotification(id);
}

/** Used by the secured cron endpoint to recover rows left queued by a process restart. */
export async function processDueNotifications(limit = 20): Promise<{ processed: number; sent: number; failed: number; queued: number }> {
  const M = WhatsAppNotificationModel(await getWebConnection());
  const now = new Date();

  // A process can die after claiming a row but before recording the outcome. Recover
  // only rows that have been "sending" well beyond the maximum provider timeout; a
  // live request must never be stolen by the cron worker.
  const staleBefore = new Date(now.getTime() - 15 * 60_000);
  await M.updateMany(
    {
      status: "sending",
      $or: [{ lastAttemptAt: { $lt: staleBefore } }, { lastAttemptAt: { $exists: false } }],
    },
    {
      $set: {
        status: "queued",
        nextAttemptAt: now,
        lastError: "Recovered after an interrupted send attempt",
      },
    },
  );

  // Permanent failures are deliberately not selected. They stay visible for manual
  // review/retry in Admin → WhatsApp, while transient failures are stored as "queued".
  const due = await M.find({
    status: "queued",
    $or: [{ nextAttemptAt: { $lte: now } }, { nextAttemptAt: { $exists: false } }],
  })
    .sort({ nextAttemptAt: 1, createdAt: 1 })
    .limit(Math.min(100, Math.max(1, limit)))
    .select({ _id: 1 })
    .lean<{ _id: unknown }[]>();

  const results = await Promise.all(due.map((row) => deliverNotification(String(row._id))));
  return {
    processed: results.length,
    sent: results.filter((r) => r.status === "sent").length,
    failed: results.filter((r) => r.status === "failed").length,
    queued: results.filter((r) => r.status === "queued").length,
  };
}

/** Sends an authorised diagnostic message through WHATSAPP_TEST_TEMPLATE. */
export async function sendTestMessage(input: { to: string; text?: string; actor: string }): Promise<DeliveryResult> {
  requireWhatsAppSend("test");
  const to = normaliseWhatsAppNumber(input.to);
  const config = getWhatsAppConfig();
  const M = WhatsAppNotificationModel(await getWebConnection());
  const doc = await M.create({
    idempotencyKey: `test:${randomUUID()}`,
    type: "test",
    templateName: config.templates.test!,
    recipient: to,
    recipientMasked: maskPhone(to),
    status: "queued",
    attempts: 0,
    nextAttemptAt: new Date(),
    testText: input.text?.trim() || "This is a test message from Woven Essence.",
  });
  return deliverNotification(String(doc._id));
}

export async function listNotifications(params: {
  page?: number;
  limit?: number;
  status?: WhatsAppNotificationStatus;
  orderNo?: string;
}): Promise<{ items: NotificationView[]; total: number; page: number; limit: number; pages: number }> {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 25));
  const match: AnyDoc = {};
  if (params.status) match.status = params.status;
  if (params.orderNo?.trim()) match.orderNo = params.orderNo.trim();
  const M = WhatsAppNotificationModel(await getWebConnection());
  const [docs, total] = await Promise.all([
    M.find(match).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean<AnyDoc[]>(),
    M.countDocuments(match),
  ]);
  return { items: docs.map(view), total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

export async function notificationDiagnostics() {
  const status = whatsappConfigStatus();
  const conn = await getWebConnection();
  const M = WhatsAppNotificationModel(conn);
  const [queued, failed, sent, delivered] = await Promise.all([
    M.countDocuments({ status: "queued" }),
    M.countDocuments({ status: "failed" }),
    M.countDocuments({ status: "sent" }),
    M.countDocuments({ status: "delivered" }),
  ]);
  return { ...status, counts: { queued, failed, sent, delivered } };
}

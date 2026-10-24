import { Schema, type Connection, type InferSchemaType } from "mongoose";
import { getModel } from "../_util";

/**
 * Durable outbox for WhatsApp messages. Rows are written before a send is attempted,
 * so a process restart does not lose the event. Provider delivery status is kept
 * separate from order/payment status — a failed WhatsApp message never changes an order.
 */
export const WhatsAppNotificationSchema = new Schema(
  {
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    orderNo: { type: String, index: true },
    customerId: Schema.Types.Mixed,
    type: {
      type: String,
      enum: ["order_confirmation", "order_shipped", "order_delivered", "test"],
      required: true,
      index: true,
    },
    templateName: { type: String, required: true },
    /** Normalised E.164 digits (no +). Kept server-side; admin responses mask it. */
    recipient: { type: String, required: true },
    recipientMasked: { type: String, required: true },
    providerMessageId: { type: String, index: true, sparse: true },
    status: {
      type: String,
      enum: ["queued", "sending", "sent", "delivered", "read", "failed", "skipped"],
      default: "queued",
      index: true,
    },
    attempts: { type: Number, default: 0 },
    lastError: String,
    lastAttemptAt: Date,
    nextAttemptAt: { type: Date, index: true },
    sentAt: Date,
    deliveredAt: Date,
    readAt: Date,
    /** Latest status reported by Meta's webhook, independent of order status. */
    providerStatus: String,
    providerStatusAt: Date,
    trackingNumber: String,
    /** Only used by admin diagnostics test messages. */
    testText: String,
  },
  { collection: "whatsappNotifications", timestamps: true },
);
export type WhatsAppNotificationDoc = InferSchemaType<typeof WhatsAppNotificationSchema>;
export const WhatsAppNotificationModel = (c: Connection) =>
  getModel<WhatsAppNotificationDoc>(c, "WhatsAppNotification", WhatsAppNotificationSchema);

/** Deduplicates Meta webhook retries (Meta retries for up to 7 days). */
export const WhatsAppWebhookEventSchema = new Schema(
  {
    eventKey: { type: String, required: true, unique: true, index: true },
    providerMessageId: { type: String, index: true },
    providerStatus: String,
    receivedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, index: { expires: 0 } },
  },
  { collection: "whatsappWebhookEvents", versionKey: false },
);
export type WhatsAppWebhookEventDoc = InferSchemaType<typeof WhatsAppWebhookEventSchema>;
export const WhatsAppWebhookEventModel = (c: Connection) =>
  getModel<WhatsAppWebhookEventDoc>(c, "WhatsAppWebhookEvent", WhatsAppWebhookEventSchema);

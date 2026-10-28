import { getWebConnection } from "@/lib/db";
import { WhatsAppNotificationModel, WhatsAppWebhookEventModel } from "@/models/web/notification.models";
import type { AnyDoc } from "@/models/_util";

export interface WhatsAppStatusError {
  code?: number;
  title?: string;
  message?: string;
  error_data?: { details?: string };
}

export interface WhatsAppStatusEvent {
  messageId: string;
  status: string;
  timestamp?: string;
  recipientId?: string;
  errors?: WhatsAppStatusError[];
}

export interface WhatsAppWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        statuses?: Array<{
          id?: string;
          status?: string;
          timestamp?: string;
          recipient_id?: string;
          errors?: WhatsAppStatusError[];
        }>;
        messages?: unknown[];
      };
    }>;
  }>;
}

/** Extract only outbound delivery-status events; inbound customer messages are ignored. */
export function parseStatusEvents(payload: WhatsAppWebhookPayload): WhatsAppStatusEvent[] {
  const events: WhatsAppStatusEvent[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const item of change.value?.statuses ?? []) {
        if (!item.id || !item.status) continue;
        events.push({
          messageId: item.id,
          status: item.status,
          timestamp: item.timestamp,
          recipientId: item.recipient_id,
          errors: item.errors,
        });
      }
    }
  }
  return events;
}

const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };
const VALID = new Set(["sent", "delivered", "read", "failed"]);

function failureSummary(errors: WhatsAppStatusError[] | undefined): string {
  const first = errors?.[0];
  if (!first) return "Meta reported that the WhatsApp message failed.";
  const detail = first.error_data?.details?.trim();
  const message = [first.title, first.message, detail].filter(Boolean).join(" — ");
  return `${message || "WhatsApp delivery failed"}${first.code ? ` (code ${first.code})` : ""}`.slice(0, 500);
}

/**
 * Apply delivery status callbacks to notification rows only.
 *
 * This deliberately never touches order or payment status: a delivered WhatsApp
 * message is not a delivered parcel. Status is monotonic (sent → delivered → read);
 * a late `failed` event cannot downgrade an already delivered/read message.
 */
export async function processDeliveryStatusWebhook(
  payload: WhatsAppWebhookPayload,
): Promise<{ received: number; updated: number; duplicates: number; unmatched: number }> {
  const events = parseStatusEvents(payload);
  if (events.length === 0) return { received: 0, updated: 0, duplicates: 0, unmatched: 0 };

  const conn = await getWebConnection();
  const Notifications = WhatsAppNotificationModel(conn);
  const WebhookEvents = WhatsAppWebhookEventModel(conn);
  let updated = 0;
  let duplicates = 0;
  let unmatched = 0;

  const remember = async (eventKey: string, event: WhatsAppStatusEvent) => {
    try {
      await WebhookEvents.updateOne(
        { eventKey },
        {
          $setOnInsert: {
            eventKey,
            providerMessageId: event.messageId,
            providerStatus: event.status,
            receivedAt: new Date(),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
          },
        },
        { upsert: true },
      );
    } catch (error) {
      // A concurrent Meta retry may win the unique eventKey insert. That is a
      // duplicate, not a processing failure.
      if ((error as { code?: number }).code !== 11000) throw error;
    }
  };

  for (const event of events) {
    const eventKey = `${event.messageId}:${event.status}:${event.timestamp ?? ""}`;
    if (await WebhookEvents.exists({ eventKey })) {
      duplicates += 1;
      continue;
    }

    if (!VALID.has(event.status)) {
      await remember(eventKey, event);
      continue;
    }

    const notification = await Notifications.findOne({ providerMessageId: event.messageId })
      .select({ _id: 1, status: 1, providerStatus: 1 })
      .lean<AnyDoc>();
    if (!notification) {
      unmatched += 1;
      await remember(eventKey, event);
      continue;
    }

    const current = String(notification.providerStatus ?? notification.status ?? "");
    const currentRank = RANK[current] ?? 0;
    const nextRank = RANK[event.status] ?? 0;
    const isFailure = event.status === "failed";
    const blockedFailure = isFailure && currentRank >= RANK.delivered;

    if (!blockedFailure && (isFailure || nextRank > currentRank)) {
      const at = event.timestamp ? new Date(Number(event.timestamp) * 1000) : new Date();
      const set: AnyDoc = {
        status: event.status,
        providerStatus: event.status,
        providerStatusAt: Number.isNaN(at.getTime()) ? new Date() : at,
      };
      if (event.status === "delivered") set.deliveredAt = set.providerStatusAt;
      if (event.status === "read") set.readAt = set.providerStatusAt;
      if (isFailure) set.lastError = failureSummary(event.errors);

      await Notifications.updateOne(
        { _id: notification._id },
        isFailure ? { $set: set } : { $set: set, $unset: { lastError: 1 } },
      );
      updated += 1;
    }

    await remember(eventKey, event);
  }

  return { received: events.length, updated, duplicates, unmatched };
}

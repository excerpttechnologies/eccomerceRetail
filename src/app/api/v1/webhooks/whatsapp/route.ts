import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import { verifyWebhookSignature } from "@/lib/whatsapp/client";
import { processDeliveryStatusWebhook, type WhatsAppWebhookPayload } from "@/lib/whatsapp/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/** Meta webhook verification: GET /api/v1/webhooks/whatsapp?hub.mode=subscribe&... */
export async function GET(req: NextRequest) {
  const config = getWhatsAppConfig();
  if (!config.enabled || !config.verifyToken) {
    return new Response("WhatsApp webhook is not configured.", { status: 503 });
  }
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token") ?? "";
  const challenge = searchParams.get("hub.challenge") ?? "";
  if (mode === "subscribe" && safeEqual(token, config.verifyToken)) {
    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response("Forbidden", { status: 403 });
}

/**
 * Meta delivery-status webhook. The raw body is verified with X-Hub-Signature-256
 * before parsing; invalid or unsigned requests are rejected.
 */
export async function POST(req: NextRequest) {
  const config = getWhatsAppConfig();
  if (!config.enabled) return new Response("WhatsApp integration is disabled.", { status: 503 });
  if (!config.appSecret) return new Response("WhatsApp webhook is not configured.", { status: 503 });

  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifyWebhookSignature(raw, signature, config.appSecret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(raw) as WhatsAppWebhookPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (payload.object !== "whatsapp_business_account") {
    // A validly signed but unrelated webhook: acknowledge without processing.
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  try {
    const result = await processDeliveryStatusWebhook(payload);
    console.info("[whatsapp] webhook processed", result);
  } catch (error) {
    // Let Meta retry; the event keys make reprocessing idempotent.
    console.error("[whatsapp] webhook processing failed", error instanceof Error ? error.message : "unknown error");
    return new Response("Webhook processing failed", { status: 500 });
  }
  return new Response("EVENT_RECEIVED", { status: 200 });
}

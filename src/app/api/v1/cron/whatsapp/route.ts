import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { fail, handler, ok } from "@/lib/api/response";
import { processDueNotifications } from "@/lib/whatsapp/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  if (!env.CRON_SECRET) return false;
  const header = req.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(env.CRON_SECRET);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/**
 * Retry queued WhatsApp notifications that were left behind by a restart or
 * transient Meta outage. Protect this with CRON_SECRET and run it every few
 * minutes (cron, systemd timer or the hosting scheduler). Permanent failures
 * are retried manually from Admin → WhatsApp, not by this loop.
 */
export const GET = handler(async (req: NextRequest) => {
  if (!env.CRON_SECRET) return fail("CRON_NOT_CONFIGURED", "Set CRON_SECRET to enable the notification retry endpoint.", 503);
  if (!authorized(req)) return fail("UNAUTHORIZED", "Invalid cron credentials", 401);
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 20);
  return ok(await processDueNotifications(Number.isFinite(limit) ? limit : 20));
});

export const POST = GET;

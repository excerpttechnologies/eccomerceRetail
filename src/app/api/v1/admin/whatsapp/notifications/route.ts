import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, handler, ok } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth";
import { listNotifications } from "@/lib/whatsapp/notifications";
import type { WhatsAppNotificationStatus } from "@/lib/whatsapp/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS = z.enum(["queued", "sending", "sent", "delivered", "read", "failed", "skipped"]);

export const GET = handler(async (req: NextRequest) => {
  await requireAdmin("settings:write");
  const params = new URL(req.url).searchParams;
  const statusRaw = params.get("status");
  const status = statusRaw ? STATUS.safeParse(statusRaw) : null;
  if (status && !status.success) return fail("VALIDATION_ERROR", "Invalid notification status", 422);
  const page = Number(params.get("page") ?? 1);
  const limit = Number(params.get("limit") ?? 25);
  const data = await listNotifications({
    page: Number.isFinite(page) ? page : 1,
    limit: Number.isFinite(limit) ? limit : 25,
    status: (status?.success ? status.data : undefined) as WhatsAppNotificationStatus | undefined,
    orderNo: params.get("orderNo") ?? undefined,
  });
  return ok(data);
});

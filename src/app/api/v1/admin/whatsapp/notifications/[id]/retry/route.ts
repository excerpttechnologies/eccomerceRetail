import type { NextRequest } from "next/server";
import { fail, handler, ok } from "@/lib/api/response";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { retryNotification } from "@/lib/whatsapp/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (req: NextRequest, ctx: Ctx) => {
  const actor = await requireAdmin("settings:write");
  const { id } = await ctx.params;
  const result = await retryNotification(id);
  if (result.status === "skipped") return fail("RETRY_NOT_ALLOWED", result.error ?? "Notification cannot be retried", 409);
  await audit(actor, "whatsapp.retry", "whatsapp_notification", id, undefined, { status: result.status }, req);
  return ok(result);
});

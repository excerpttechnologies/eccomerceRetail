import type { NextRequest } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/api/body";
import { fail, handler, ok } from "@/lib/api/response";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { notificationDiagnostics, sendTestMessage } from "@/lib/whatsapp/notifications";
import { WhatsAppError } from "@/lib/whatsapp/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Safe configuration diagnostics — never returns tokens, secrets or raw phone numbers. */
export const GET = handler(async () => {
  await requireAdmin("settings:write");
  return ok(await notificationDiagnostics());
});

/** Send an authorised test message through the optional WHATSAPP_TEST_TEMPLATE. */
export const POST = handler(async (req: NextRequest) => {
  const actor = await requireAdmin("settings:write");
  const b = await parseBody(req, z.object({ to: z.string().min(8).max(20), text: z.string().max(500).optional() }));
  if (!b.ok) return b.res;
  try {
    const result = await sendTestMessage({ to: b.data.to, text: b.data.text, actor: actor.email });
    await audit(actor, "whatsapp.test", "whatsapp", undefined, undefined, { status: result.status }, req);
    return ok(result);
  } catch (error) {
    if (error instanceof WhatsAppError) {
      return fail(error.code, error.message, error.httpStatus && error.httpStatus >= 400 ? error.httpStatus : 503);
    }
    throw error;
  }
});

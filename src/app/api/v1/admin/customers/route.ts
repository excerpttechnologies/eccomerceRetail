import type { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth";
import { getCustomers } from "@/repositories";

export const dynamic = "force-dynamic";
export const GET = handler(async (req: NextRequest) => {
  await requireAdmin("customers:read");
  const sp = req.nextUrl.searchParams;
  const { items, ...meta } = await getCustomers().list({ q: sp.get("q") ?? undefined, page: Number(sp.get("page") ?? 1), limit: Number(sp.get("limit") ?? 25) });
  return ok(items, meta);
});

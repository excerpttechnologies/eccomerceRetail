import type { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth";
import type { OrderStatus } from "@/domain/types";
import { getOrders } from "@/repositories";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  await requireAdmin("orders:read");
  const sp = req.nextUrl.searchParams;
  const { items, ...meta } = await getOrders().list({
    status: (sp.get("status") as OrderStatus) || undefined,
    q: sp.get("q") ?? undefined,
    from: sp.get("from") ? new Date(sp.get("from")!) : undefined,
    to: sp.get("to") ? new Date(sp.get("to")!) : undefined,
    page: Number(sp.get("page") ?? 1),
    limit: Number(sp.get("limit") ?? 25),
  });
  return ok(items, meta);
});

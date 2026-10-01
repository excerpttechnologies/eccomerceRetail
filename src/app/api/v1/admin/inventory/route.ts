import type { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { getMasterData, getSite } from "@/repositories";

export const dynamic = "force-dynamic";
/** GET — stock summary + low/out-of-stock list. Stock is always read live from master data. */
export const GET = handler(async (req: NextRequest) => {
  await requireAdmin("inventory:read");
  const settings = await getSite().settings();
  const threshold = settings.commerce?.lowStockThreshold ?? 3;
  const master = getMasterData();
  const page = Number(req.nextUrl.searchParams.get("page") ?? 1);
  const [summary, low, out] = await Promise.all([
    master.products.stockSummary(threshold),
    master.products.list({ page, limit: 50, sort: "featured", inStock: true }),
    master.products.list({ page: 1, limit: 50, sort: "featured", inStock: false }),
  ]);
  return ok({
    summary,
    threshold,
    dataSource: env.DATA_SOURCE,
    lastSyncAt: settings.erp?.lastSyncAt ?? null,
    lastSyncStatus: settings.erp?.lastSyncStatus ?? null,
    lowStock: low.items.filter((p) => p.stock.qty <= threshold),
    outOfStock: out.items.filter((p) => p.stock.qty <= 0),
  });
});

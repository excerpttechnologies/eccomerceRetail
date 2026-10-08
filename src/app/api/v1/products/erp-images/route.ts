import type { NextRequest } from "next/server";
import { getBarcodeImageSeries, type BarcodeSeriesGroup } from "@/lib/barcode-image-series";
import { redactMongoUri } from "@/lib/db";
import { fail, handler, ok } from "@/lib/api/response";

export const dynamic = "force-dynamic";

/** GET /api/v1/products/erp-images?group=sarees|fabrics */
export const GET = handler(async (req: NextRequest) => {
  const group = req.nextUrl.searchParams.get("group");
  if (group !== "sarees" && group !== "fabrics") {
    return fail("VALIDATION_ERROR", "group must be either sarees or fabrics", 400);
  }

  try {
    const series = await getBarcodeImageSeries(group as BarcodeSeriesGroup);
    return ok(series, { group, source: "erp", collection: "barcodeLabel" });
  } catch (error) {
    console.error("[products/erp-images] RetailERP query failed:", redactMongoUri(String((error as Error)?.message ?? error)));
    return fail("ERP_UNAVAILABLE", "Unable to load product images. Please try again.", 503);
  }
});
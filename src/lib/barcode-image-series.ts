import { cache } from "react";
import { getBarcodeLabels } from "@/repositories";
import type { BarcodeProduct } from "@/domain/types";
import { getWebConnection, redactMongoUri } from "@/lib/db";
import { ProductWebMetaModel } from "@/models/web/content.models";

export type BarcodeSeriesGroup = "sarees" | "fabrics";
export type BarcodeImageFilters = { group?: string; business?: string; status?: string; uomType?: string; q?: string; barcode?: string };

export type StorefrontCategoryGroup = BarcodeSeriesGroup | "plain-fabrics" | "dupatta";

export const ERP_CATEGORY_TITLES: Record<StorefrontCategoryGroup, string> = {
  sarees: "Sarees",
  fabrics: "Fabrics",
  "plain-fabrics": "Plain Fabrics",
  dupatta: "Dupatta",
};

/** Exact modern ERP Item group IDs verified to reference storefront barcodeLabel records. */
export const ERP_CATEGORY_GROUP_IDS: Record<StorefrontCategoryGroup, readonly string[]> = {
  sarees: ["6a9905f8ee2f8f36193a0ce2"],
  fabrics: ["6a9904d4ee2f8f36193a0a52"],
  "plain-fabrics": ["6a990579ee2f8f36193a0c14"],
  dupatta: ["6a990672ee2f8f36193a0db0"],
};

export function applyPrintDescriptionOverrides(items: BarcodeProduct[], overrides: Map<string, string>) {
  return items.map((item) => {
    const description = overrides.get(item.barcode)?.trim();
    return description ? { ...item, printDescription: description } : item;
  });
}

async function withPrintDescriptionOverrides(items: BarcodeProduct[]) {
  if (!items.length) return items;
  try {
    const metas = await ProductWebMetaModel(await getWebConnection())
      .find({ sku: { $in: [...new Set(items.map((item) => item.barcode))] } })
      .select({ sku: 1, printDescriptionOverride: 1 })
      .lean();
    const overrides = new Map(
      metas
        .filter((meta) => typeof meta.printDescriptionOverride === "string" && meta.printDescriptionOverride.trim())
        .map((meta) => [meta.sku, meta.printDescriptionOverride as string]),
    );
    return applyPrintDescriptionOverrides(items, overrides);
  } catch (error) {
    console.error("[barcode-image-series] product description lookup failed:", redactMongoUri(String((error as Error)?.message ?? error)));
    return items;
  }
}

const getBarcodeImageScopes = cache(async (group: StorefrontCategoryGroup) => {
  const labelIds = await getBarcodeLabels().getLabelIdsForItemGroups([...ERP_CATEGORY_GROUP_IDS[group]]);
  return { labelIds };
});

/** All ERP barcode-label images for a clothing category, paged and filtered for the storefront. */
export async function getBarcodeImageCatalog(group: StorefrontCategoryGroup, page: number, filters: BarcodeImageFilters = {}, limit = 48) {
  const barcodeLabels = getBarcodeLabels();
  const { labelIds } = await getBarcodeImageScopes(group);
  if (!labelIds.length) return { items: [], total: 0, page, pages: 0 };
  const { barcode, ...listFilters } = filters;
  const detailView = Boolean(barcode?.trim());
  const catalog = await barcodeLabels.list({
    labelIds,
    availableOnly: true,
    ...listFilters,
    ...(detailView ? { barcodes: [barcode!.trim()] } : {}),
    page: detailView ? 1 : page,
    limit: detailView ? 1 : limit,
  });
  return {
    items: await withPrintDescriptionOverrides(catalog.items),
    total: detailView ? Number(catalog.items.length > 0) : catalog.total,
    page: detailView ? 1 : catalog.page,
    pages: detailView ? Number(catalog.items.length > 0) : catalog.pages,
  };
}

export async function getBarcodeImageFilterOptions(group: StorefrontCategoryGroup) {
  const scopes = await getBarcodeImageScopes(group);
  if (!scopes.labelIds.length) return { status: [], group: [], business: [], uomType: [], total: 0 };
  const facets = await getBarcodeLabels().facets({ ...scopes, availableOnly: true });
  return facets;
}

export async function getBarcodeImageSeries(group: StorefrontCategoryGroup) {
  const barcodeLabels = getBarcodeLabels();
  const { labelIds } = await getBarcodeImageScopes(group);
  if (!labelIds.length) {
    return (["8A", "9A"] as const).map((prefix) => ({ title: `${ERP_CATEGORY_TITLES[group]} - ${prefix} Series`, items: [] as BarcodeProduct[] }));
  }

  const seenImages = new Set<string>();
  const series = [];
  for (const prefix of ["8A", "9A"] as const) {
    const result = await barcodeLabels.list({ labelIds, seriesPrefix: prefix, limit: 12, imageCheckDeadlineMs: 5_000 });
    const items = result.items
      .filter((item): item is typeof item & { image: string } => {
        if (!item.image) return false;
        const imageUrl = item.image.split("?")[0];
        if (seenImages.has(imageUrl)) return false;
        seenImages.add(imageUrl);
        return true;
      });
    series.push({
      title: `${ERP_CATEGORY_TITLES[group]} - ${prefix} Series`,
      items,
    });
  }
  const items = await withPrintDescriptionOverrides(series.flatMap((group) => group.items));
  const descriptionsById = new Map(items.map((item) => [item.id, item.printDescription]));
  return series.map((group) => ({
    ...group,
    items: group.items.map((item) => {
      const printDescription = descriptionsById.get(item.id);
      return printDescription ? { ...item, printDescription } : item;
    }),
  }));
}

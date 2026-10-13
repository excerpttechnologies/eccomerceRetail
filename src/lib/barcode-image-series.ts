import { getBarcodeLabels } from "@/repositories";
import type { BarcodeProduct } from "@/domain/types";
import { getWebConnection, redactMongoUri } from "@/lib/db";
import { ProductWebMetaModel } from "@/models/web/content.models";

export type BarcodeSeriesGroup = "sarees" | "fabrics";
export type BarcodeImageFilters = { group?: string; business?: string; status?: string; uomType?: string; q?: string; barcode?: string };

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

async function getBarcodeImageScopes(group: BarcodeSeriesGroup) {
  const facets = await getBarcodeLabels().facets();
  const groupIds = facets.group
    .filter((option) => {
      const name = option.label.split(" · ")[0].trim().toLowerCase();
      return group === "sarees" ? /^sarees?$/.test(name) : /^fabrics?$/.test(name);
    })
    .map((option) => option.value);
  const businessIds = facets.business
    .filter((option) =>
      group === "sarees" ? /saree/i.test(option.label) : /fabric|fabs/i.test(option.label),
    )
    .map((option) => option.value);
  return { groupIds, businessIds };
}

/** All ERP barcode-label images for a clothing category, paged and filtered for the storefront. */
export async function getBarcodeImageCatalog(group: BarcodeSeriesGroup, page: number, filters: BarcodeImageFilters = {}, limit = 48) {
  const barcodeLabels = getBarcodeLabels();
  const { groupIds, businessIds } = await getBarcodeImageScopes(group);
  if (!groupIds.length && !businessIds.length) return { items: [], total: 0, page, pages: 0 };
  const { barcode, ...listFilters } = filters;
  const detailView = Boolean(barcode?.trim());
  const catalog = await barcodeLabels.list({
    groupIds,
    businessIds,
    availableOnly: true,
    ...listFilters,
    ...(detailView ? { barcodes: [barcode!.trim()] } : {}),
    page: detailView ? 1 : page,
    limit: detailView ? 1 : limit,
    imageCheckDeadlineMs: 30_000,
  });
  const items = catalog.items.filter((item): item is typeof item & { image: string } => Boolean(item.image));
  return {
    items: await withPrintDescriptionOverrides(items),
    total: detailView ? Number(items.length > 0) : catalog.total,
    page: detailView ? 1 : catalog.page,
    pages: detailView ? Number(items.length > 0) : catalog.pages,
  };
}

export async function getBarcodeImageFilterOptions(group: BarcodeSeriesGroup) {
  const scopes = await getBarcodeImageScopes(group);
  const facets = await getBarcodeLabels().facets({ ...scopes, availableOnly: true });
  return facets;
}

export async function getBarcodeImageSeries(group: BarcodeSeriesGroup) {
  const barcodeLabels = getBarcodeLabels();
  const { groupIds, businessIds } = await getBarcodeImageScopes(group);
  const scopes = [
    ...groupIds.map((id) => ({ group: id })),
    ...businessIds.map((id) => ({ business: id })),
  ];

  const seenImages = new Set<string>();
  const series = [];
  for (const prefix of ["8A", "9A"] as const) {
    const results = await Promise.all(
      scopes.map((scope) =>
        barcodeLabels.list({
          ...scope,
          seriesPrefix: prefix,
          limit: 12,
          imageCheckDeadlineMs: 5_000,
        }),
      ),
    );
    const items = results
      .flatMap((result) => result.items)
      .filter((item): item is typeof item & { image: string } => {
        if (!item.image) return false;
        const imageUrl = item.image.split("?")[0];
        if (seenImages.has(imageUrl)) return false;
        seenImages.add(imageUrl);
        return true;
      });
    series.push({
      title: `${group === "sarees" ? "Sarees" : "Fabrics"} - ${prefix} Series`,
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

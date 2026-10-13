import { getBarcodeLabels } from "@/repositories";

export type BarcodeSeriesGroup = "sarees" | "fabrics";
export type BarcodeImageFilters = { group?: string; business?: string; status?: string; uomType?: string; q?: string };

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
  const catalog = await barcodeLabels.list({
    groupIds,
    businessIds,
    ...filters,
    page,
    limit,
    imageCheckDeadlineMs: 30_000,
  });
  return {
    items: catalog.items.filter((item): item is typeof item & { image: string } => Boolean(item.image)),
    total: catalog.total,
    page: catalog.page,
    pages: catalog.pages,
  };
}

export async function getBarcodeImageFilterOptions(group: BarcodeSeriesGroup) {
  const scopes = await getBarcodeImageScopes(group);
  const facets = await getBarcodeLabels().facets(scopes);
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
  return series;
}

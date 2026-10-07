import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import type { ProductListParams } from "@/domain/types";
import { parseProductListParams } from "@/lib/api/query";
import { getMasterData, getSite } from "@/repositories";
import { collectionToListParams } from "@/repositories/web/site.repository";
import { Listing } from "@/components/listing/listing";
import { Pagination } from "@/components/listing/toolbar";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ErpImageGallery } from "@/components/home/sections";
import { getBarcodeImageCatalog, getBarcodeImageSeries, type BarcodeSeriesGroup } from "@/lib/barcode-image-series";

type SP = Record<string, string | string[] | undefined>;
const toSearchParams = (sp: SP) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) (Array.isArray(v) ? v : v ? [v] : []).forEach((x) => u.append(k, x));
  return u;
};

function erpGroupForSlug(slug: string): BarcodeSeriesGroup | null {
  if (slug === "sarees") return "sarees";
  if (slug === "fabrics") return "fabrics";
  return null;
}

async function resolve(slug: string) {
  const master = getMasterData();
  if (slug === "new-arrivals") return { kind: "special" as const, title: "New Arrivals", description: "Fresh off the loom this month.", base: { newArrivals: true, sort: "newest" } as ProductListParams };
  const category = await master.categories.getBySlug(slug);
  if (category) {
    const parent = category.parentId ? await master.categories.getById(category.parentId) : null;
    return { kind: "category" as const, category, parent, base: { category: slug } as ProductListParams };
  }
  const collection = await getSite().collectionBySlug(slug);
  if (collection) return { kind: "collection" as const, collection, base: collectionToListParams(collection) };
  return null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const erpGroup = erpGroupForSlug(slug);
  if (erpGroup) {
    const title = erpGroup === "sarees" ? "Sarees" : "Fabrics";
    return { title, description: `Browse ${title.toLowerCase()} with images from RetailERP.` };
  }
  const r = await resolve(slug);
  if (!r) return {};
  if (r.kind === "category") return { title: r.category.name, description: `Shop ${r.category.name.toLowerCase()} from Woven Essence.` };
  if (r.kind === "collection") return { title: r.collection.seoTitle ?? r.collection.name, description: r.collection.seoDescription ?? r.collection.description ?? undefined };
  return { title: r.title, description: r.description };
}

export default async function CollectionPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const erpGroup = erpGroupForSlug(slug);
  if (erpGroup) {
    const rawPage = Array.isArray(sp.page) ? sp.page[0] : sp.page;
    const parsedPage = rawPage && /^\d+$/.test(rawPage) ? Number(rawPage) : 1;
    const page = Number.isSafeInteger(parsedPage) ? Math.max(1, parsedPage) : 1;
    const [result, featuredSeries] = await Promise.all([
      getBarcodeImageCatalog(erpGroup, page),
      page === 1 ? getBarcodeImageSeries(erpGroup) : Promise.resolve([]),
    ]);
    const featuredItems = featuredSeries.flatMap((series) => series.items);
    const images = new Set(featuredItems.map((item) => item.image?.split("?")[0]));
    const items = [
      ...featuredItems,
      ...result.items.filter((item) => {
        const image = item.image?.split("?")[0];
        if (!image || images.has(image)) return false;
        images.add(image);
        return true;
      }),
    ];
    const title = erpGroup === "sarees" ? "Sarees" : "Fabrics";
    const pageCount = Math.max(result.pages, 1);
    return (
      <div className="mx-auto max-w-site px-4 py-6 sm:px-6">
        <Breadcrumbs items={[{ label: title }]} />
        <div className="mt-4">
          <h1 className="we-rule text-4xl">All {title}</h1>
          <p className="mt-3 max-w-2xl text-sm text-muted">Images and item descriptions are loaded from RetailERP.</p>
        </div>
        {items.length ? (
          <ErpImageGallery title={`All ${title} from RetailERP`} items={items} />
        ) : (
          <p className="py-12 text-center text-sm text-muted">No ERP images are available on this page.</p>
        )}
        <p className="text-center text-xs uppercase tracking-widest text-muted">
          Showing {items.length} ERP images · Page {result.page} of {pageCount}
        </p>
        <Suspense>
          <Pagination page={result.page} pages={result.pages} />
        </Suspense>
      </div>
    );
  }
  const r = await resolve(slug);
  if (!r) notFound();
  const parsed = parseProductListParams(toSearchParams(sp));
  const urlParams = parsed.ok ? parsed.params : {};
  // Fixed params win over URL params so a curated collection can't be widened by the URL.
  const listParams: ProductListParams = { ...urlParams, ...r.base, filters: { ...(urlParams.filters ?? {}), ...(r.base.filters ?? {}) } };

  if (r.kind === "category") {
    const rootCategory = r.parent ?? r.category;
    const rootName = rootCategory.name.trim().toLowerCase();
    const barcodeGroup = /^sarees?$/.test(rootName)
      ? "sarees"
      : /^fabrics?$/.test(rootName)
        ? "fabrics"
        : null;
    const erpItems = barcodeGroup
      ? (await getBarcodeImageSeries(barcodeGroup)).flatMap((series) => series.items)
      : [];
    const tree = await getMasterData().categories.tree();
    const node = tree.find((t) => t.slug === (r.parent?.slug ?? r.category.slug));
    const subs = node?.children ?? [];
    return (
      <Listing title={r.category.name} breadcrumbs={[...(r.parent ? [{ label: r.parent.name, href: `/collections/${r.parent.slug}` }] : []), { label: r.category.name }]} params={listParams} erpItems={erpItems}>
        {subs.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2">
            {subs.map((s) => (
              <Link key={s.id} href={`/collections/${s.slug}`} className={`rounded-full border px-4 py-1.5 text-xs uppercase tracking-widest ${s.slug === r.category.slug ? "border-olive bg-olive text-ivory" : "border-line text-olive hover:border-gold"}`}>{s.name}</Link>
            ))}
          </div>
        )}
      </Listing>
    );
  }
  if (r.kind === "collection") {
    return <Listing title={r.collection.name} description={r.collection.description} banner={r.collection.banner?.desktop} breadcrumbs={[{ label: "Collections", href: "/collections" }, { label: r.collection.name }]} params={listParams} />;
  }
  return <Listing title={r.title} description={r.description} breadcrumbs={[{ label: r.title }]} params={listParams} />;
}

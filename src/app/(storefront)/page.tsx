import type { Metadata } from "next";
import { getMasterData, getSite } from "@/repositories";
import { collectionToListParams } from "@/repositories/web/site.repository";
import { getBarcodeImageSeries } from "@/lib/barcode-image-series";
import { getCategoryTree, getSettings } from "@/lib/site-data";
import { HeroCarousel } from "@/components/home/hero-carousel";
import { CategoryTiles, ChipStrip, ErpImageGallery, FeaturedCollections, HelpJump, InstagramStrip, LifestyleBanners, Newsletter, ProductSection, SupportPanel, Testimonials, TrustBadges } from "@/components/home/sections";

export const metadata: Metadata = { title: "Handloom Sarees & Fabrics" };

/** Home page is assembled from admin-orderable homepage sections. */
export default async function Home() {
  const site = getSite();
  const master = getMasterData();
  const [settings, sections, supportSection] = await Promise.all([getSettings(), site.homepageSections(), site.homepageSection("support")]);
  const fabricSeries = await getBarcodeImageSeries("fabrics");
  const fabricImages = fabricSeries.flatMap((series) =>
    series.items.flatMap((item) => item.image ? [item.image] : []),
  );

  const rendered = await Promise.all(
    sections.map(async (s) => {
      const cfg = (s.config ?? {}) as Record<string, unknown>;
      const limit = Number(cfg.limit ?? 8);
      switch (s.key) {
        case "hero": {
          const banners = await site.banners("hero");
          return <HeroCarousel key={s.key} slides={banners.filter((b) => b.image?.desktop).map((b) => ({ id: String(b._id), title: b.title, subtitle: b.subtitle, ctaLabel: b.ctaLabel, ctaHref: b.ctaHref, desktop: b.image?.desktop ?? "", mobile: b.image?.mobile, alt: b.image?.alt, align: b.align }))} />;
        }
        case "trust":
          return <TrustBadges key={s.key} badges={settings.trustBadges ?? []} />;
        case "categories":
          return <CategoryTiles key={s.key} categories={await getCategoryTree()} title={s.title} subtitle={s.subtitle} />;
        case "featuredCollections":
          return <FeaturedCollections key={s.key} collections={await site.collections({ featuredOnly: true })} title={s.title} subtitle={s.subtitle} />;
        case "newArrivals": {
          const r = await master.products.list({ newArrivals: true, sort: "newest", limit });
          return <ProductSection key={s.key} title={s.title ?? "New arrivals"} subtitle={s.subtitle} href="/collections/new-arrivals" items={r.items} />;
        }
        case "bestSellers": {
          const r = await master.products.list({ sort: "best_selling", limit });
          return <ProductSection key={s.key} title={s.title ?? "Best sellers"} subtitle={s.subtitle} href="/collections/sarees?sort=best_selling" items={r.items} />;
        }
        case "collection": {
          const col = cfg.slug ? await site.collectionBySlug(String(cfg.slug)) : null;
          if (!col) return null;
          const r = await master.products.list({ ...collectionToListParams(col), limit });
          return <ProductSection key={s.key + col.slug} title={s.title ?? col.name} subtitle={s.subtitle ?? col.description} href={`/collections/${col.slug}`} items={r.items} />;
        }
        case "occasions": {
          const values = await master.products.distinctValues("occasion");
          const sample = await master.products.list({ limit: 1 });
          return <ChipStrip key={s.key} title={s.title ?? "Shop by occasion"} subtitle={s.subtitle} items={values.slice(0, 8).map((v, i) => ({ label: v, href: `/collections/sarees?occasion=${encodeURIComponent(v)}`, image: sample.items[0]?.images[i % 2] }))} />;
        }
        case "fabrics": {
          const values = await master.products.distinctValues("fabric");
          return <ChipStrip key={s.key} title={s.title ?? "Shop by fabric"} subtitle={s.subtitle} items={values.slice(0, 12).map((v) => ({ label: v, href: `/collections/sarees?fabric=${encodeURIComponent(v)}` }))} />;
        }
        case "lifestyle":
          return <LifestyleBanners key={s.key} banners={await site.banners("lifestyle")} />;
        case "testimonials":
          return <Testimonials key={s.key} items={await site.testimonials()} title={s.title} />;
        case "instagram": {
          const r = await master.products.list({ sort: "newest", limit: 6 });
          return <InstagramStrip key={s.key} handle={settings.social?.instagram ? "@" + settings.social.instagram.split("/").filter(Boolean).pop() : undefined} images={r.items.map((p) => p.images[0]).filter(Boolean)} />;
        }
        case "newsletter":
          return <Newsletter key={s.key} title={s.title} subtitle={s.subtitle} />;
        case "support":
          return <SupportPanel key={s.key} title={s.title} subtitle={s.subtitle} contact={settings.contact} whatsappNumber={settings.whatsappNumber} />;
        default:
          return null;
      }
    }),
  );

  return (
    <>
      <ErpImageGallery images={fabricImages} />
      {rendered}
      {!supportSection && <SupportPanel title="How can we help?" contact={settings.contact} whatsappNumber={settings.whatsappNumber} />}
      <HelpJump />
    </>
  );
}

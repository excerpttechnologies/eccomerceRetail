import type { Metadata } from "next";
import type { CategoryNode } from "@/domain/types";
import { getMasterData, getSite } from "@/repositories";
import { collectionToListParams } from "@/repositories/web/site.repository";
import { getBarcodeImageSeries } from "@/lib/barcode-image-series";
import { getCategoryTree, getSettings } from "@/lib/site-data";
import { HeroCarousel } from "@/components/home/hero-carousel";
import { CategoryTiles, ChipStrip, ErpImageGallery, FeaturedCollections, HelpJump, InstagramStrip, LifestyleBanners, Newsletter, ProductSection, SupportPanel, Testimonials, TrustBadges } from "@/components/home/sections";

export const metadata: Metadata = { title: "Handloom Sarees & Fabrics" };

const fallbackHeroSlides = [
  {
    id: "default-kanchipuram",
    title: "The Kanchipuram Edit",
    subtitle: "Temple borders, korvai weaves, twelve new colours for the wedding season.",
    ctaLabel: "Shop Kanchipuram",
    ctaHref: "/collections/sarees?fabric=Kanchipuram%20Silk",
    desktop: "https://wovenessence.in/images/hero-1.jpg",
    alt: "Kanchipuram silk saree",
  },
  {
    id: "default-yanai",
    title: "Yanai Motif Sarees",
    subtitle: "The elephant, woven the way Kanchi has always woven it.",
    ctaLabel: "See the collection",
    ctaHref: "/collections/yanai-motif-sarees",
    desktop: "https://wovenessence.in/images/hero-2.jpg",
    alt: "Elephant motif saree",
  },
  {
    id: "default-everyday",
    title: "Everyday Handlooms",
    subtitle: "Linen, Chanderi and cotton — under ₹5,000.",
    ctaLabel: "Shop under ₹5,000",
    ctaHref: "/collections/under-5000",
    desktop: "https://wovenessence.in/images/hero-3.jpg",
    alt: "Linen saree",
  },
];

const defaultCategories: CategoryNode[] = [
  { id: "default-sarees", name: "Sarees", slug: "sarees", image: "https://wovenessence.in/images/col-bridal.jpg", sortOrder: 0, isActive: true, children: [] },
  { id: "default-fabrics", name: "Fabrics", slug: "fabrics", image: "https://wovenessence.in/images/col-banarasi.jpg", sortOrder: 1, isActive: true, children: [] },
  { id: "default-plain-fabrics", name: "Plain Fabrics", slug: "plain-fabrics", image: "https://wovenessence.in/images/col-5000.jpg", sortOrder: 2, isActive: true, children: [] },
  { id: "default-dupatta", name: "Dupatta", slug: "dupatta", image: "https://wovenessence.in/images/col-yanai.jpg", sortOrder: 3, isActive: true, children: [] },
];

const defaultFeaturedCollections = [
  {
    id: "default-yanai",
    name: "Yanai Motif Sarees",
    slug: "yanai-motif-sarees",
    description: "Traditional Kanchipuram sarees with the elephant motif.",
    image: "https://wovenessence.in/images/col-yanai.jpg",
  },
  {
    id: "default-bridal",
    name: "Bridal Kanchipuram",
    slug: "bridal-kanchipuram",
    description: "Rich Kanchipuram silks for wedding celebrations.",
    image: "https://wovenessence.in/images/col-bridal.jpg",
  },
  {
    id: "default-banarasi",
    name: "Festive Banarasi",
    slug: "festive-banarasi",
    description: "Banarasi weaves in festive colours.",
    image: "https://wovenessence.in/images/col-banarasi.jpg",
  },
  {
    id: "default-under-5000",
    name: "Under ₹5,000",
    slug: "under-5000",
    description: "Everyday handlooms under ₹5,000.",
    image: "https://wovenessence.in/images/col-5000.jpg",
  },
];

/** Home page is assembled from admin-orderable homepage sections. */
export default async function Home() {
  const site = getSite();
  const master = getMasterData();
  const [settings, sections, supportSection, heroBanners] = await Promise.all([
    getSettings(),
    site.homepageSections(),
    site.homepageSection("support"),
    site.banners("hero"),
  ]);
  const homepageSections = sections.length
    ? sections
    : [
        { key: "categories", title: "Shop by category", subtitle: null, config: {} },
        { key: "featuredCollections", title: "Curated collections", subtitle: null, config: {} },
      ];
  const configuredHeroSlides = heroBanners
    .filter((banner) => banner.image?.desktop?.trim())
    .map((banner) => {
      const image = banner.image;
      return {
        id: String(banner._id),
        title: banner.title,
        subtitle: banner.subtitle,
        ctaLabel: banner.ctaLabel,
        ctaHref: banner.ctaHref,
        desktop: image?.desktop ?? "",
        mobile: image?.mobile,
        alt: image?.alt,
        align: banner.align,
      };
    });
  const hero = (
    <HeroCarousel
      slides={configuredHeroSlides.length ? configuredHeroSlides : fallbackHeroSlides}
    />
  );
  const [sareeSeries, fabricSeries] = await Promise.all([
    getBarcodeImageSeries("sarees"),
    getBarcodeImageSeries("fabrics"),
  ]);
  const sareeItems = sareeSeries.flatMap((series) => series.items);
  const fabricItems = fabricSeries.flatMap((series) => series.items);

  const rendered = await Promise.all(
    homepageSections.map(async (s) => {
      const cfg = (s.config ?? {}) as Record<string, unknown>;
      const limit = Number(cfg.limit ?? 8);
      switch (s.key) {
        case "hero": {
          return <div key={s.key}>{hero}</div>;
        }
        case "trust":
          return <TrustBadges key={s.key} badges={settings.trustBadges ?? []} />;
        case "categories": {
          const categories = await getCategoryTree();
          return <CategoryTiles key={s.key} categories={categories.length ? categories : defaultCategories} title={s.title} subtitle={s.subtitle} />;
        }
        case "featuredCollections": {
          const collections = await site.collections({ featuredOnly: true });
          return (
            <FeaturedCollections
              key={s.key}
              collections={collections.length
                ? collections.map((collection) => ({
                    id: String(collection._id),
                    name: collection.name,
                    slug: collection.slug,
                    description: collection.description,
                    image: collection.banner?.desktop,
                  }))
                : defaultFeaturedCollections}
              title={s.title}
              subtitle={s.subtitle}
            />
          );
        }
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
      {!homepageSections.some((section) => section.key === "hero") && hero}
      {rendered}
      <ErpImageGallery title="Sarees from RetailERP" items={sareeItems} />
      <ErpImageGallery title="Fabrics from RetailERP" items={fabricItems} />
      {!supportSection && <SupportPanel title="How can we help?" contact={settings.contact} whatsappNumber={settings.whatsappNumber} />}
      <HelpJump />
    </>
  );
}

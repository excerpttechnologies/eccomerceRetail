/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Connection } from "mongoose";
import {
  BannerModel,
  CmsPageModel,
  CollectionModel,
  HomepageSectionModel,
  MenuItemModel,
  SiteSettingsModel,
  TestimonialModel,
  type BannerDoc,
  type CmsPageDoc,
  type CollectionDoc,
  type HomepageSectionDoc,
  type MenuItemDoc,
  type SiteSettingsDoc,
  type TestimonialDoc,
} from "@/models/web/content.models";
import { FILTER_KEYS, type FilterKey, type ProductListParams } from "@/domain/types";
import { DEFAULT_MENU } from "@/lib/default-menu";

export interface MenuNode {
  id: string;
  label: string;
  kind: "top" | "group" | "link";
  href?: string;
  image?: string;
  badge?: string;
  children: MenuNode[];
}

export interface SiteSettings extends Omit<SiteSettingsDoc, "key"> {
  id: string;
}

/**
 * Everything the storefront chrome needs that is NOT ERP data: settings,
 * mega-menu, banners, homepage layout, curated collections, CMS pages.
 */
export class SiteRepository {
  constructor(private readonly conn: () => Promise<Connection>) {}

  async settings(): Promise<SiteSettings> {
    const M = SiteSettingsModel(await this.conn());
    let doc = await M.findOne({ key: "default" }).lean();
    if (!doc) doc = (await M.create({ key: "default" })).toObject();
    const { _id, key: _key, ...rest } = doc as any;
    return { id: String(_id), ...rest };
  }

  async menu(): Promise<MenuNode[]> {
    const M = MenuItemModel(await this.conn());
    const items = (await M.find({ isActive: true }).sort({ sortOrder: 1 }).lean()) as MenuItemDoc[];
    if (!items.length) return DEFAULT_MENU;
    const nodes = new Map<string, MenuNode>();
    for (const it of items) {
      nodes.set(String(it._id), {
        id: String(it._id),
        label: it.label,
        kind: it.kind,
        href: resolveHref(it),
        image: it.image ?? undefined,
        badge: it.badge ?? undefined,
        children: [],
      });
    }
    const roots: MenuNode[] = [];
    for (const it of items) {
      const node = nodes.get(String(it._id))!;
      const parent = it.parentId ? nodes.get(String(it.parentId)) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots.length ? roots : DEFAULT_MENU;
  }

  async banners(placement: BannerDoc["placement"]): Promise<BannerDoc[]> {
    const M = BannerModel(await this.conn());
    const now = new Date();
    return (await M.find({
      placement,
      isActive: true,
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $exists: false } }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gte: now } }] },
      ],
    })
      .sort({ sortOrder: 1 })
      .lean()) as BannerDoc[];
  }

  async homepageSections(): Promise<HomepageSectionDoc[]> {
    const M = HomepageSectionModel(await this.conn());
    return (await M.find({ isVisible: true }).sort({ sortOrder: 1 }).lean()) as HomepageSectionDoc[];
  }

  async homepageSection(key: string): Promise<HomepageSectionDoc | null> {
    const M = HomepageSectionModel(await this.conn());
    return (await M.findOne({ key }).lean()) as HomepageSectionDoc | null;
  }

  async collections(opts: { featuredOnly?: boolean } = {}): Promise<CollectionDoc[]> {
    const M = CollectionModel(await this.conn());
    const q: any = { isActive: true };
    if (opts.featuredOnly) q.isFeatured = true;
    return (await M.find(q).sort({ sortOrder: 1 }).lean()) as CollectionDoc[];
  }

  async collectionBySlug(slug: string): Promise<CollectionDoc | null> {
    const M = CollectionModel(await this.conn());
    return (await M.findOne({ slug, isActive: true }).lean()) as CollectionDoc | null;
  }

  async testimonials(): Promise<TestimonialDoc[]> {
    const M = TestimonialModel(await this.conn());
    return (await M.find({ isActive: true }).sort({ sortOrder: 1 }).lean()) as TestimonialDoc[];
  }

  async page(slug: string): Promise<CmsPageDoc | null> {
    const M = CmsPageModel(await this.conn());
    return (await M.findOne({ slug, isPublished: true }).lean()) as CmsPageDoc | null;
  }

  async pages(type?: CmsPageDoc["type"]): Promise<CmsPageDoc[]> {
    const M = CmsPageModel(await this.conn());
    return (await M.find({ isPublished: true, ...(type ? { type } : {}) })
      .sort({ sortOrder: 1 })
      .lean()) as CmsPageDoc[];
  }
}

/** Translate a curated collection's rules into repository list params. */
export function collectionToListParams(col: CollectionDoc): ProductListParams {
  if (col.type === "manual") return { skus: col.skus ?? [] };
  const params: ProductListParams = { filters: {} };
  for (const rule of col.rules ?? []) {
    const key = rule.key as string;
    const value = rule.value;
    if ((FILTER_KEYS as readonly string[]).includes(key)) {
      const values = Array.isArray(value) ? value.map(String) : [String(value)];
      params.filters![key as FilterKey] = values;
    } else if (key === "category") params.category = String(value);
    else if (key === "priceMin") params.priceMin = Number(value);
    else if (key === "priceMax") params.priceMax = Number(value);
    else if (key === "discountMin") params.discountMin = Number(value);
    else if (key === "newArrivals") params.newArrivals = Boolean(value);
    else if (key === "tags") params.tags = Array.isArray(value) ? value.map(String) : [String(value)];
    else if (key === "q") params.q = String(value);
  }
  return params;
}

function resolveHref(it: MenuItemDoc): string | undefined {
  if (it.href) return it.href;
  if (it.categorySlug && it.filterKey && it.filterValue)
    return `/collections/${it.categorySlug}?${encodeURIComponent(it.filterKey)}=${encodeURIComponent(it.filterValue)}`;
  if (it.categorySlug) return `/collections/${it.categorySlug}`;
  return undefined;
}

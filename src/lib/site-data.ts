import { cache } from "react";
import { getMasterData, getSite } from "@/repositories";

/** Per-request memoised loaders so header, footer and page share one query. */
export const getSettings = cache(() => getSite().settings());
export const getMenu = cache(() => getSite().menu());
export const getCategoryTree = cache(() => getMasterData().categories.tree());
export const getStores = cache(() => getMasterData().stores.list());
export const getFooterPages = cache(async () => {
  const pages = await getSite().pages();
  return pages.map((p) => ({ title: p.title, slug: p.slug, type: p.type }));
});

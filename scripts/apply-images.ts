/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * npm run images
 *
 * Swaps the old picsum.photos placeholders in an existing database for the local imagery in
 * public/images, without re-seeding (the seed wipes customers and orders). Only placeholder
 * URLs are replaced, so images set in the admin panel are kept. In DATA_SOURCE=erp mode the
 * RetailERP products and categories are never written.
 */
import "dotenv/config";
import { env } from "@/lib/env";
import { closeConnections, getWebConnection } from "@/lib/db";
import { CATEGORY_FIELDS, PRODUCT_FIELDS } from "@/lib/erp-mapping";
import { getPath } from "@/lib/utils";
import { CategoryModel } from "@/models/erp/category.model";
import { ProductModel } from "@/models/erp/product.model";
import { BannerModel, CollectionModel } from "@/models/web/content.models";
import { COLLECTION_BANNERS, HERO_IMAGES, LIFESTYLE_IMAGES, categoryImage, productImages } from "./site-images";

const PLACEHOLDER = /picsum\.photos/;

async function main() {
  const conn = await getWebConnection();
  const counts: Record<string, number> = {};

  if (env.DATA_SOURCE === "mock") {
    const Product = ProductModel(conn);
    const products = await Product.find({ [PRODUCT_FIELDS.images]: PLACEHOLDER }).lean<any[]>();
    if (products.length) {
      await Product.bulkWrite(products.map((p) => ({
        updateOne: { filter: { _id: p._id }, update: { $set: { [PRODUCT_FIELDS.images]: productImages(String(getPath(p, PRODUCT_FIELDS.sku)), getPath(p, PRODUCT_FIELDS.color) as string | undefined) } } },
      })));
    }
    counts.products = products.length;

    const Category = CategoryModel(conn);
    const categories = await Category.find({}).lean<any[]>();
    const nameById = new Map(categories.map((c) => [String(c._id), String(getPath(c, CATEGORY_FIELDS.name))]));
    const stale = categories.filter((c) => PLACEHOLDER.test(String(getPath(c, CATEGORY_FIELDS.image) ?? "")));
    if (stale.length) {
      await Category.bulkWrite(stale.map((c) => {
        const parentId = getPath(c, CATEGORY_FIELDS.parentId);
        const image = categoryImage(String(getPath(c, CATEGORY_FIELDS.name)), parentId ? nameById.get(String(parentId)) : null);
        return { updateOne: { filter: { _id: c._id }, update: { $set: { [CATEGORY_FIELDS.image]: image } } } };
      }));
    }
    counts.categories = stale.length;
  } else {
    console.log("DATA_SOURCE=erp: product and category images come from RetailERP, leaving them alone.");
  }

  const Banner = BannerModel(conn);
  counts.banners = 0;
  for (const [i, image] of HERO_IMAGES.entries()) {
    counts.banners += (await Banner.updateOne({ placement: "hero", sortOrder: i, "image.desktop": PLACEHOLDER }, { $set: { "image.desktop": image.desktop, "image.mobile": image.mobile } })).modifiedCount;
  }
  for (const [i, desktop] of LIFESTYLE_IMAGES.entries()) {
    counts.banners += (await Banner.updateOne({ placement: "lifestyle", sortOrder: i, "image.desktop": PLACEHOLDER }, { $set: { "image.desktop": desktop } })).modifiedCount;
  }

  const Collection = CollectionModel(conn);
  counts.collections = 0;
  for (const [slug, desktop] of Object.entries(COLLECTION_BANNERS)) {
    counts.collections += (await Collection.updateOne({ slug, "banner.desktop": PLACEHOLDER }, { $set: { "banner.desktop": desktop } })).modifiedCount;
  }

  console.log("Updated", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeConnections());

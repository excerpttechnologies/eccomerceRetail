import type { Metadata } from "next";
import { getWishlistSkus } from "@/lib/cart-server";
import { getMasterData } from "@/repositories";
import { toProductCard } from "@/lib/erp-mapping";
import { Empty } from "@/components/ui/empty";
import { ProductGrid } from "@/components/product/product-grid";

export const metadata: Metadata = { title: "Wishlist", robots: { index: false } };

export default async function WishlistPage() {
  const skus = await getWishlistSkus();
  const products = skus.length ? await getMasterData().products.getBySkus(skus) : [];
  return (
    <div className="mx-auto max-w-site px-4 py-8 sm:px-6">
      <h1 className="we-rule text-4xl">Wishlist</h1>
      <div className="mt-8">{products.length ? <ProductGrid items={products.map(toProductCard)} /> : <Empty title="Nothing saved yet" text="Tap the heart on any product to keep it here." href="/collections/sarees" />}</div>
    </div>
  );
}

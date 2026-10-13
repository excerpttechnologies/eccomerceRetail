"use client";
import Image from "next/image";
import { ShoppingBag } from "lucide-react";
import type { BarcodeProduct } from "@/domain/types";
import { useCart } from "@/hooks/useCart";
import { formatINR } from "@/lib/utils";
import { WishlistButton } from "./wishlist-button";
import { ComingSoonImage } from "@/components/ui/coming-soon-image";

export function BarcodeProductGrid({ items }: { items: BarcodeProduct[] }) {
  const { add } = useCart();
  if (!items.length) return null;

  return (
    <>
      {add.isError && <p role="alert" className="mb-4 text-sm text-red-700">{(add.error as Error).message}</p>}
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => {
          const price = item.price ?? 0;
          const sellingPrice = item.offerPrice && item.offerPrice < price ? item.offerPrice : price;
          const outOfStock = item.status !== "IN_STOCK" || (item.qty != null && item.qty <= 0);
          return (
            <article key={item.id} className="group min-w-0">
              <div className="relative aspect-[3/4] overflow-hidden rounded-sm bg-line">
                {item.image ? (
                  <Image src={item.image} alt={item.itemName || item.name} fill unoptimized sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
                ) : <ComingSoonImage className="absolute inset-0" />}
                <div className="absolute right-2 top-2"><WishlistButton sku={item.barcode} /></div>
                {outOfStock && <span className="absolute inset-x-0 bottom-0 bg-ink/75 py-2 text-center text-[11px] uppercase tracking-widest text-ivory">Unavailable</span>}
              </div>
              <div className="mt-3">
                <p className="line-clamp-2 text-sm font-medium text-ink">{item.itemName || item.name}</p>
                <p className="mt-1 line-clamp-2 min-h-8 text-xs text-muted">{item.printDescription || item.group || item.itemCode || ""}</p>
                {price > 0 && <p className="mt-1 text-sm font-medium">{formatINR(sellingPrice)}{sellingPrice < price && <span className="ml-2 text-xs text-muted line-through">{formatINR(price)}</span>}</p>}
                <button type="button" disabled={outOfStock || add.isPending} onClick={() => add.mutate({ sku: item.barcode })} className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-olive px-3 text-xs font-medium uppercase tracking-widest text-ivory transition-colors hover:bg-maroon disabled:cursor-not-allowed disabled:opacity-50">
                  <ShoppingBag className="h-4 w-4" /> Add to bag
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
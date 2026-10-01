# RetailERP integration guide

Woven Essence reads **master data** (products, categories, stores, stock, price) from
RetailERP and never writes to it. Everything the website itself owns (carts,
wishlists, web orders, banners, menus, CMS, settings, reviews, audit log) lives in a
separate database. Switching between the seeded mock database and the real ERP is a
matter of three environment variables and one file.

```
DATA_SOURCE=erp
ERP_MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.e3s8dbr.mongodb.net
ERP_DB_NAME=grooretailerp1
```

| Concern | Where it lives | Mode `mock` | Mode `erp` |
| --- | --- | --- | --- |
| Products, categories, stores | `ERP_DB_NAME` (master connection) | seeded copy in `WEB_DB_NAME`, writable by `npm run seed` | RetailERP, **read-only** (`readOnlyGuard` throws on any write) |
| Field names | `src/lib/erp-mapping.ts` | same | same |
| Carts, wishlists, orders, banners, menu, CMS, settings, reviews, admin users, audit | `WEB_DB_NAME` (web connection) | writable | writable |

> **Admin → Products already reads real RetailERP data** from `grooretailerp1.barcodeLabel`,
> whatever `DATA_SOURCE` is set to. See [barcodeLabel-product-mapping.md](barcodeLabel-product-mapping.md)
> for the verified field names, relationships and image rules. The storefront still follows
> `DATA_SOURCE` and the placeholder `PRODUCT_FIELDS` below.

## 1. Discover the real field names

The sandbox this project was scaffolded in could not reach Atlas, so every field in
`erp-mapping.ts` is a **placeholder** marked `// TODO: verify against RetailERP`.
Run the introspection script from a machine that can reach the cluster:

```bash
npm run erp:introspect -- "mongodb+srv://<user>:<password>@cluster0.e3s8dbr.mongodb.net" grooretailerp1
# add --examples to include (non-PII) sample values per field
```

It writes `erp-introspection.json` containing, for every collection: document count,
each field path, observed types and coverage %, plus a best-guess of which collections
are products / categories / orders / customers / stores. PII-looking fields (mobile,
email, address, gst) are never sampled.

## 2. Update the mapping — the only file that changes

`src/lib/erp-mapping.ts` is the single translation layer. UI code and repositories
only know the **left-hand keys**; the right-hand values are RetailERP paths.

```ts
export const ERP_COLLECTIONS = { products: "products", categories: "categories", ... };

export const PRODUCT_FIELDS = {
  name: "productName",   // ← change to whatever the introspection shows, e.g. "item_name"
  motif: "pattern",      // dotted paths work too: "attributes.pattern"
  images: "images",      // string[], {url}[], {path}[] and csv strings are all handled
  isActive: "isActive",  // true/false, 1/0, "Y"/"N", "active" all handled
  ...
};
```

Things to check after introspection:

- **`PRODUCT_CATEGORY_REF`** — does `products.category` hold the category *name*,
  its `_id`, or a slug? Set to `"name" | "id" | "slug"`.
- **`ACTIVE_PRODUCT_QUERY` / `ACTIVE_CATEGORY_QUERY`** — adjust if the ERP uses a
  `status` field instead of a boolean.
- **`PRODUCT_FILTER_FIELDS`** — which ERP paths feed the facet sidebar
  (fabric, weave, craft, occasion, colour, motif, border).
- **`productSort`** — which field represents "newest"/"best selling".
- Stock: if RetailERP keeps stock per store in a separate collection, add a
  `stockQty` lookup in `MongoProductRepository` and keep the UI key unchanged.
- Images: add the ERP/CDN hostname to `images.remotePatterns` in `next.config.ts`.

Nothing else in the codebase needs to change: `defineFromMapping()` builds the
Mongoose schemas from these tables (with `strict: false`, so unknown ERP fields are
preserved), and every repository query is expressed in UI keys and translated at
runtime.

## 3. Verify the connection

```bash
DATA_SOURCE=erp npm run dev
curl http://localhost:3000/api/v1/erp/status
```

The endpoint returns a ping (db name, collection counts, latency), the active mapping
tables and a sample product mapped through `mapProduct()` so you can eyeball the
result. The same check is wired to the **Settings → Integrations → Test RetailERP
connection** button in the admin panel.

## 4. Create website metadata for ERP products

RetailERP has no slugs or SEO fields. They live in the website-owned
`productWebMeta` collection, keyed by SKU:

```bash
DATA_SOURCE=erp npm run erp:sync-meta
```

This creates a `productWebMeta` row (`slug = slugify(name)-slugify(sku)`) for every
active ERP product that does not have one, and stamps `siteSettings.erp.lastSyncAt`.
It is idempotent and safe to run on a schedule (the admin Inventory page has a
"Re-sync" button that calls the same function). Existing slugs are never rewritten,
so URLs stay stable when a product is renamed in the ERP.

## 5. Read-only guarantee

- `getMasterConnection()` opens a **separate** Mongoose connection to `ERP_DB_NAME`.
- Every ERP model is registered with `readOnlyGuard()`, which rejects `save`,
  `insertMany`, `updateOne/Many`, `findOneAndUpdate`, `deleteOne/Many`,
  `replaceOne` and `bulkWrite` when `DATA_SOURCE=erp`.
- `npm run seed` refuses to run in erp mode.
- Use a MongoDB user with the `read` role on `grooretailerp1` for defence in depth.

## 6. Website orders → ERP (future write-back)

Web orders are stored in `WEB_DB_NAME.orders` **using RetailERP field names**
(`orderNo`, `customerId`, `items[].sku`, `netAmount`, `paymentMode`, ...) via
`buildOrderDoc()`. When RetailERP exposes a sales-order API or an import
collection, the sync job only has to copy documents — no re-mapping. The same holds
for `customers` (`customerName`, `mobile`, `addresses[]`, `loyaltyPoints`).

## 7. Mapping a collection that does not exist yet

If the ERP splits data differently (e.g. `item_master` + `item_stock` + `item_price`):

1. Add the collection names to `ERP_COLLECTIONS`.
2. Add a Mongoose model in `src/models/erp/` (use `defineFromMapping` or a plain schema).
3. In `MongoProductRepository`, add an aggregation `$lookup` so the pipeline yields a
   single document that satisfies `PRODUCT_FIELDS`. The rest of the app is untouched.

## 8. What the admin panel can and cannot change

| Data | Owner | Editable in admin? |
| --- | --- | --- |
| Product name, price, MRP, GST, stock, attributes, images | RetailERP | No — shown with a "Synced from RetailERP" badge |
| Product slug, SEO title/description, featured flag, extra images | Website (`productWebMeta`) | Yes — Products → row → Web settings |
| Categories, stores | RetailERP | No |
| Menu, banners, collections, homepage sections, CMS, testimonials, coupons | Website | Yes |
| Orders, customers (website registrations) | Website, stored with ERP field names | Yes (status workflow, AWB) |

Stock and prices are **never cached**: every product list, cart hydration and checkout re-reads master data,
so the site can never sell a SKU RetailERP has already sold in-store.

## 9. Runtime switches

- `DATA_SOURCE=erp` + `ERP_MONGODB_URI` / `ERP_DB_NAME` — restart the app after changing.
- Admin → Inventory & sync → **Test ERP connection** calls `POST /api/v1/admin/erp/test` (pings, lists collections).
- Admin → Inventory & sync → **Re-sync web meta** calls `POST /api/v1/admin/erp/sync-meta` (same as `npm run erp:sync-meta`).
- `GET /api/v1/erp/status` is safe to expose to monitoring.

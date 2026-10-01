# barcodeLabel → Admin Products mapping

Admin → Products (`/admin/products`) lists RetailERP **barcode labels**. Every field name below was
read from real documents in `grooretailerp1.barcodeLabel` on 2026-10-01 (27,487 documents; field
coverage from a 3,000-document sample, counts from full-collection aggregations).

| | |
| --- | --- |
| Database | `grooretailerp1` (env `ERP_MONGODB_URI` / alias `ERP_MONGO_URI`, `ERP_DB_NAME`) |
| Collection | `barcodeLabel` — read-only from the website |
| Code | mapping `src/lib/erp-mapping.ts` (`BARCODE_LABEL_FIELDS`, `mapBarcodeLabel`), images `src/lib/erp-images.ts`, queries `src/repositories/mongo/barcode-label.repository.ts` |
| API | `GET /api/v1/admin/products`, `GET /api/v1/admin/products/facets`, `PATCH /api/v1/admin/products` (web overlay only) — all behind `requireAdmin("products:*")` |

## What a row is

One `barcodeLabel` document = one printed label for one sellable unit: a unique piece
(`batchType: "unique"`, 20,433) or a batch such as a fabric roll (`batchType: "batch"`, 7,054).
The page is therefore **barcode-oriented**: one row per document.

- `itemCode` equals `barcodeNo` on 21,098 labels. On the rest it is a shared item code
  (`FX-CRB` alone covers 1,540 labels), so it is not a product key.
- The ERP's own e-commerce layer also works per label: `ecommerceproducts.erpRef.barcodeLabelId`,
  `ecommerceProducts.erpDocumentId` and `items.barcodeManagement.sourceBarcodeLabel` all point at
  `barcodeLabel._id`.
- Barcodes are **not unique**. No `barcodeLabel` index is unique, including
  `barcodeNo_1_businessId_1`. 234 barcodes appear on more than one document (287 extra):
  - 212 of them span businesses;
  - 35 (barcode, business) pairs repeat inside one business (106 documents).
- Many of these duplicates are different products: 110 of the cross-business groups and 27 of
  the same-business groups have different descriptions.
- Each document is its own row. The row shows "on N labels", and the drawer warns that the
  website's overlay (`productWebMeta`, keyed by barcode) is shared by all of them.

## Field mapping

| UI field | MongoDB source | Coverage | Transformation |
| --- | --- | --- | --- |
| Row id | `_id` | 100% | hex string |
| Barcode | `barcodeNo` | 100% | none; drawn as Code 128 (set B) SVG — values are 4–10 printable ASCII chars |
| Item code | `itemCode` | 100% | none |
| Old barcode | `oldBarcode` | 87% | hidden when equal to `barcodeNo` |
| Product name | `supplierDescription` → `printDescription` → `itemName` → `itemCode` → `barcodeNo` | 100% / 99% / 23% | first non-empty |
| Item name | `itemName` | 23% | hidden when equal to the name |
| Print description | `printDescription` | 99% | hidden when equal to the name |
| Group | `groupId` → `productgroup._id` → `productgroup.name` | 20,798 resolve | `$lookup`; `groupId` is a hex string. Groups are per business and 10 names repeat, so the filter shows "SAREES · TEMPLE FABRICS" when a name is ambiguous |
| Business | `businessId` → `business._id` → `business.name` | 27,447 resolve | `$lookup`; hex string |
| Quantity | `qtyNum` (fallback `qty`) | 100% | rounded to 3 decimals (`0.04999999999999999` → `0.05`); `qty` disagrees with `qtyNum` on 1,146 docs, `qtyNum` wins |
| UOM | `uom` (fallback `uomType`) | 24% / 100% | none |
| Price | `retailPrice` | 100% | string or number → number (the RetailERP backend also prices from `retailPrice`) |
| Offer price | `offerPrice` | 23% | shown only when > 0 |
| HSN / GST % | `hsn` / `gst` | 100% / 24% | GST → number |
| Status | `status` | 100% | raw value; `IN_STOCK` 27,419 · `SOLD` 51 · `VOID` 7 · `IN_TRANSIT` 7 · `HISTORY` 3 |
| Batch type, GRC no. | `batchType`, `grcNo` | 100%, 23% | none |
| Image | `imageUrl`, then `filePath` | 86% non-empty | see below |
| Created / updated | `createdAt`, `updatedAt` | 100% | ISO string |

Empty values are omitted from the API response, so the UI never prints `undefined`, `null` or `N/A`.

## Images

The image always comes from the **same document** as the barcode. `imageUrl` is tried first, then
`filePath`. Only hosts in `ERP_IMAGE_SPACES_HOSTS` or `ERP_IMAGE_BASE` are considered; each
candidate is checked server-side with a 1-byte ranged GET, and the first one that loads is returned.

- **Caching:** a working image is cached 6 h, a 403/404 for 15 min. 429/5xx answers are not cached.
- **Unreachable hosts:** a host that times out or does not resolve is skipped for 60 s.
- **Page deadline:** a page waits at most 2.5 s for checks. Past that, unchecked candidates go to
  the browser as-is and the checks finish in the background.

| `imageUrl` value | Docs | Handling | Result |
| --- | ---: | --- | --- |
| `https://templeimg.blr1.digitaloceanspaces.com/<key>?X-Amz-…` | 15,593 | Presigned on 7–8 Aug with `X-Amz-Expires=300`, so every stored signature is expired. The query is stripped; if `DO_SPACES_KEY`/`SECRET` are set, a fresh presigned URL is made instead | ~55% public-read objects load. ~39% are private (403) and need the keys. ~6% do not exist (404) |
| `/august_8A_images/<barcode>.jpg` | 3,136 | Served by the deployed RetailERP app: `ERP_IMAGE_BASE` + path | all sampled load |
| `data:image/jpeg;base64,…` | 4,768 | One identical 2,042-byte grey "image" icon (sha256 `ec0d9181…`): a placeholder, not a product photo | "no image" fallback |
| `/api/files/<hash>.jpg` | 5 | The ERP's current upload path, so the newest labels use it. The deployed app answers 401 (needs its own login); `filePath` on ERP_IMAGE_BASE and on the Spaces bucket is 404 | fallback until the ERP serves these publicly or issues a read token |
| `http://wovenessencemobile.etpl.ai/uploads/…` | 11 | Host no longer resolves; `filePath` on ERP_IMAGE_BASE is 404 | fallback |
| empty | 3,975 | — | fallback |

Thumbnails go through `next/image`, so the table downloads ~1 KB WebP thumbnails instead of
~200 KB JPEGs. The allowed hosts are the exact `ERP_IMAGE_SPACES_HOSTS` plus the `ERP_IMAGE_BASE`
host (see `next.config.ts`). There is no wildcard, because `/_next/image` is public and would
otherwise proxy any bucket.

## Relationships checked and not used

| Reference | Finding | Decision |
| --- | --- | --- |
| `itemId` → `item._id` | 3,382 labels; `item.name` equals `barcodeLabel.itemName` on all 3,381 that join; `item.image` is always empty | not joined (no extra data) |
| `productImage` collection | 10 documents, keyed by `barcodeGenerated` (set on 13% of labels); 7 hold an `imageUrl` on the dead `wovenessencemobile.etpl.ai` host, 3 hold inline `imageData` | not joined (no loadable image to gain) |
| `supplierId` | 3,384 hex ids, 0 of 500 sampled match `supplier._id`; 7,967 are codes (`G589`) with no matching field | not shown (and `supplier` holds PII) |
| `groupId` like `mtr-6`, `pc-86` | 722 labels, no `productgroup` document | no group shown; not offered as a filter |
| `businessId` `6aabd7c858bc2f2790eba600` | 40 labels, not in `business` | filter label "Unlisted business ·eba600" |

## Queries

- **List:** one aggregation —
  `$match → $sort {_id:-1} → $skip → $limit → $project → $lookup productgroup → $lookup business`.
  Lookups run only for the page, two per row, so there is no N+1. In parallel,
  `countDocuments(match)` (or `estimatedDocumentCount()` when unfiltered).
- **Search:** case-insensitive, regex-escaped substring over `barcodeNo`, `itemCode`,
  `oldBarcode`, `itemName`, `supplierDescription`, `printDescription`, `designNo`.
- **Filters:** exact match on `status`, `groupId`, `businessId`, `uomType`.
- **Facets:** a single `$facet` with `$group` per filter, plus name lookups.
- Measured on Atlas (44 MB, avg 1.6 KB per document): page ≈ 100 ms, search count ≈ 230 ms,
  facets ≈ 150 ms.
- Existing indexes used: `_id`, `status_1`, `businessId_1`. No index was created — the website
  must not write to the ERP database (the model sets `autoIndex: false`, `autoCreate: false` and an
  always-on read-only guard).
- If the collection grows past ~250k documents, ask the ERP team for an index on `groupId` and a
  text index for search.

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Connection, FilterQuery, Model, PipelineStage } from "mongoose";
import { env } from "@/lib/env";
import {
  BARCODE_JOINED,
  BARCODE_LABEL_FIELDS as B,
  BARCODE_SEARCH_FIELDS,
  BUSINESS_FIELDS,
  ERP_BARCODE_COLLECTIONS,
  PRODUCT_GROUP_FIELDS,
  mapBarcodeLabel,
} from "@/lib/erp-mapping";
import { mapLimit, resolveRecordImage, type ImageResolveOptions } from "@/lib/erp-images";
import { escapeRegex } from "@/lib/utils";
import { BarcodeLabelModel } from "@/models/erp/barcode-label.model";
import type { AnyDoc } from "@/models/_util";
import type { BarcodeFacets, BarcodeListParams, BarcodeProduct, FacetOption, Paginated } from "@/domain/types";
import type { BarcodeLabelRepository } from "../types";

const MAX_LIMIT = 96;
const IMAGE_CONCURRENCY = 12;
/** Longest a page waits for image checks; slower checks finish in the background and warm the cache. */
const IMAGE_DEADLINE_MS = 2500;

/** Only the fields the mapper reads leave the database. */
const PROJECTION: Record<string, 1> = Object.fromEntries(
  Object.values(B)
    .filter((p) => p !== "_id")
    .map((p) => [p, 1]),
);

/** $lookup by a hex-string id held in `localField` (the ERP stores these refs as strings). */
function lookupName(from: string, localField: string, nameField: string, as: string): PipelineStage[] {
  return [
    {
      $lookup: {
        from,
        let: { ref: `$${localField}` },
        pipeline: [
          { $match: { $expr: { $eq: ["$_id", { $convert: { input: "$$ref", to: "objectId", onError: null, onNull: null } }] } } },
          { $project: { _id: 0, n: `$${nameField}` } },
          { $limit: 1 },
        ],
        as,
      },
    },
    { $set: { [as]: { $first: `$${as}.n` } } },
  ];
}

const JOIN_STAGES: PipelineStage[] = [
  ...lookupName(ERP_BARCODE_COLLECTIONS.productGroups, B.groupId, PRODUCT_GROUP_FIELDS.name, BARCODE_JOINED.groupName),
  ...lookupName(ERP_BARCODE_COLLECTIONS.businesses, B.businessId, BUSINESS_FIELDS.name, BARCODE_JOINED.businessName),
];

export class MongoBarcodeLabelRepository implements BarcodeLabelRepository {
  constructor(private readonly conn: () => Promise<Connection>) {}

  private async M() {
    return BarcodeLabelModel(await this.conn());
  }

  private imageOptions(): ImageResolveOptions {
    return {
      base: env.ERP_IMAGE_BASE,
      spacesHosts: env.ERP_IMAGE_SPACES_HOSTS,
      spaces: env.DO_SPACES_KEY && env.DO_SPACES_SECRET ? { accessKeyId: env.DO_SPACES_KEY, secretAccessKey: env.DO_SPACES_SECRET } : undefined,
    };
  }

  private match(params: BarcodeListParams): FilterQuery<AnyDoc> {
    const and: FilterQuery<AnyDoc>[] = [];
    if (params.status) and.push({ [B.status]: params.status });
    if (params.group) and.push({ [B.groupId]: params.group });
    if (params.business) and.push({ [B.businessId]: params.business });
    if (params.uomType) and.push({ [B.uomType]: params.uomType });
    if (params.q?.trim()) {
      const rx = new RegExp(escapeRegex(params.q.trim()), "i");
      and.push({ $or: BARCODE_SEARCH_FIELDS.map((f) => ({ [f]: rx })) });
    }
    if (!and.length) return {};
    return and.length === 1 ? and[0] : { $and: and };
  }

  /** Raw docs -> domain rows. A record that cannot be mapped is logged and skipped, never fatal. */
  private async hydrate(docs: AnyDoc[]): Promise<{ items: BarcodeProduct[]; skipped: number }> {
    const opts = this.imageOptions();
    const deadlineAt = Date.now() + IMAGE_DEADLINE_MS;
    let skipped = 0;
    const rows = await mapLimit(docs, IMAGE_CONCURRENCY, async (raw) => {
      try {
        const product = mapBarcodeLabel(raw);
        const img = await resolveRecordImage([raw[B.imageUrl], raw[B.filePath]], opts, undefined, deadlineAt);
        return { ...product, ...img };
      } catch (e) {
        skipped++;
        console.warn(`[barcodeLabel] skipped record ${String(raw?._id)}: ${(e as Error).message}`);
        return null;
      }
    });
    return { items: rows.filter((r): r is BarcodeProduct => r !== null), skipped };
  }

  async list(params: BarcodeListParams): Promise<Paginated<BarcodeProduct> & { skipped: number }> {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? 40));
    const match = this.match(params);
    const M = await this.M();
    const [docs, total] = await Promise.all([
      M.aggregate<AnyDoc>([
        { $match: match },
        { $sort: { _id: -1 } }, // newest first; _id is unique + indexed, so paging is stable
        { $skip: (page - 1) * limit },
        { $limit: limit },
        { $project: PROJECTION },
        ...JOIN_STAGES,
      ]),
      Object.keys(match).length ? M.countDocuments(match) : M.estimatedDocumentCount(),
    ]);
    const [{ items, skipped }, shared] = await Promise.all([this.hydrate(docs), this.labelsPerBarcode(M, docs)]);
    for (const p of items) {
      const n = shared.get(p.barcode);
      if (n && n > 1) p.barcodeLabelCount = n;
    }
    return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)), skipped };
  }

  /**
   * Barcodes are not unique: 234 appear on several labels, sometimes for different products
   * (no unique index, even per business). One indexed query per page counts them so the UI
   * can say that web settings keyed by barcode are shared.
   */
  private async labelsPerBarcode(M: Model<AnyDoc>, docs: AnyDoc[]): Promise<Map<string, number>> {
    const barcodes = Array.from(new Set(docs.map((d) => d[B.barcode]).filter((b): b is string => typeof b === "string" && b !== "")));
    if (!barcodes.length) return new Map();
    const rows = await M.aggregate<{ _id: string; n: number }>([{ $match: { [B.barcode]: { $in: barcodes } } }, { $group: { _id: `$${B.barcode}`, n: { $sum: 1 } } }]);
    return new Map(rows.map((r) => [r._id, r.n]));
  }

  async facets(): Promise<BarcodeFacets> {
    const M = await this.M();
    const countBy = (field: string): PipelineStage.FacetPipelineStage[] => [
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $match: { _id: { $nin: [null, ""] } } },
    ];
    const [res] = await M.aggregate<any>([
      {
        $facet: {
          status: [...countBy(B.status), { $sort: { count: -1 } }],
          uomType: [...countBy(B.uomType), { $sort: { count: -1 } }],
          // productgroup is per business and names repeat ("SAREES" exists in several), so the owning business is fetched too.
          group: [
            ...countBy(B.groupId),
            {
              $lookup: {
                from: ERP_BARCODE_COLLECTIONS.productGroups,
                let: { ref: "$_id" },
                pipeline: [
                  { $match: { $expr: { $eq: ["$_id", { $convert: { input: "$$ref", to: "objectId", onError: null, onNull: null } }] } } },
                  { $project: { _id: 0, n: `$${PRODUCT_GROUP_FIELDS.name}`, b: `$${PRODUCT_GROUP_FIELDS.businessId}` } },
                  { $limit: 1 },
                ],
                as: "pg",
              },
            },
            { $set: { pg: { $first: "$pg" } } },
            { $lookup: { from: ERP_BARCODE_COLLECTIONS.businesses, localField: "pg.b", foreignField: "_id", as: "biz" } },
            { $project: { count: 1, label: "$pg.n", business: { $first: `$biz.${BUSINESS_FIELDS.name}` } } },
          ],
          business: [...countBy(B.businessId), ...(lookupName(ERP_BARCODE_COLLECTIONS.businesses, "_id", BUSINESS_FIELDS.name, "label") as PipelineStage.FacetPipelineStage[])],
          total: [{ $count: "n" }],
        },
      },
    ]);
    type Row = { _id: unknown; count: number; label?: string; business?: string };
    const opt = (r: Row, label?: string): FacetOption => ({ value: String(r._id), label: label ?? String(r._id), count: r.count });
    const byLabel = (a: FacetOption, b: FacetOption) => a.label.localeCompare(b.label);
    // Group ids with no productgroup document (import leftovers like "pc-86") cannot be named, so they are not offered.
    const groups: Row[] = (res?.group ?? []).filter((r: Row) => r.label);
    const nameUses = new Map<string, number>();
    for (const r of groups) nameUses.set(r.label!, (nameUses.get(r.label!) ?? 0) + 1);
    return {
      status: (res?.status ?? []).map((r: Row) => opt(r)),
      uomType: (res?.uomType ?? []).map((r: Row) => opt(r)),
      group: groups.map((r) => opt(r, nameUses.get(r.label!)! > 1 ? `${r.label} · ${r.business ?? "unlisted business"}` : r.label)).sort(byLabel),
      business: (res?.business ?? []).map((r: Row) => opt(r, r.label ?? `Unlisted business ·${String(r._id).slice(-6)}`)).sort(byLabel),
      total: res?.total?.[0]?.n ?? 0,
    };
  }

  async getByBarcode(barcode: string): Promise<BarcodeProduct | null> {
    const M = await this.M();
    const doc = await M.findOne({ [B.barcode]: barcode }, PROJECTION).sort({ _id: -1 }).lean<AnyDoc>();
    if (!doc) return null;
    try {
      return mapBarcodeLabel(doc);
    } catch {
      return null;
    }
  }
}

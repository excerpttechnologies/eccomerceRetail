"use client";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { BarcodeFacets, BarcodeProduct, FacetOption } from "@/domain/types";
import { api } from "@/hooks/api";
import { formatINR } from "@/lib/utils";
import { PageHeader, Pager, Table } from "@/components/admin/table";
import { SpecForm } from "@/components/admin/form";
import { ProductThumb } from "@/components/admin/product-thumb";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Barcode } from "@/components/ui/barcode";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Input, Select } from "@/components/ui/input";

type Row = BarcodeProduct & { _id: string; web: { slug: string; seoTitle?: string; seoDescription?: string; isFeatured?: boolean; salesCount?: number } | null };
type Filters = { status: string; group: string; business: string; uomType: string };

const NO_FILTERS: Filters = { status: "", group: "", business: "", uomType: "" };
const STATUS_TONE: Record<string, BadgeTone> = { IN_STOCK: "green", IN_TRANSIT: "blue", SOLD: "muted", HISTORY: "muted", VOID: "red" };
const statusLabel = (s: string) => s.toLowerCase().replace(/_/g, " ");
const fmtQty = (r: BarcodeProduct) => (r.qty == null ? null : `${r.qty.toLocaleString("en-IN", { maximumFractionDigits: 3 })}${r.uom ? ` ${r.uom}` : ""}`);
const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : undefined);

function FilterSelect({ label, value, options, onChange, format = (s) => s }: { label: string; value: string; options?: FacetOption[]; onChange: (v: string) => void; format?: (s: string) => string }) {
  if (!options?.length) return null;
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="w-auto max-w-[14rem]">
      <option value="">{label}: all</option>
      {options.map((o) => <option key={o.value} value={o.value}>{format(o.label)} ({o.count.toLocaleString("en-IN")})</option>)}
    </Select>
  );
}

export default function ProductsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [editing, setEditing] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const qs = new URLSearchParams({ page: String(page), limit: "40", ...(debouncedQ ? { q: debouncedQ } : {}), ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) }).toString();
  const list = useQuery({ queryKey: ["admin", "products", qs], queryFn: () => api<Row[]>(`/api/v1/admin/products?${qs}`), placeholderData: keepPreviousData });
  const facets = useQuery({ queryKey: ["admin", "products", "facets"], queryFn: () => api<BarcodeFacets>("/api/v1/admin/products/facets"), staleTime: 60_000 });
  const meta = list.data?.meta as { pages?: number; total?: number; skipped?: number } | undefined;
  const f = facets.data?.data;
  const setFilter = (k: keyof Filters) => (v: string) => { setFilters((s) => ({ ...s, [k]: v })); setPage(1); };
  const filtered = !!debouncedQ || Object.values(filters).some(Boolean);
  const stale = list.isPlaceholderData; // previous rows shown while the new query loads

  // A narrower search can leave the current page past the end; go back to the last real page.
  useEffect(() => {
    if (!stale && meta?.pages && page > meta.pages) setPage(meta.pages);
  }, [stale, meta?.pages, page]);

  const save = useMutation({
    mutationFn: (v: Record<string, unknown>) => api("/api/v1/admin/products", { method: "PATCH", json: { sku: editing!.barcode, slug: v.slug, seoTitle: v.seoTitle, seoDescription: v.seoDescription, isFeatured: v.isFeatured } }),
    onSuccess: () => { setEditing(null); qc.invalidateQueries({ queryKey: ["admin", "products"] }); },
    onError: (e) => setError((e as Error).message),
  });

  return (
    <div>
      <PageHeader title="Products" subtitle={meta?.total != null ? `${meta.total.toLocaleString("en-IN")} ${filtered ? "matching " : ""}barcode labels · source: RetailERP barcodeLabel (read-only)` : undefined}>
        <Badge tone="green">Synced from RetailERP</Badge>
      </PageHeader>
      <p className="mb-4 rounded-sm border border-gold/40 bg-gold/5 p-3 text-xs text-ink/80">
        Every row is a RetailERP barcode label. Name, price, quantity, status and images are owned by RetailERP and cannot be edited here. The website adds a slug, SEO fields and a “featured” flag on top.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <Input placeholder="Search barcode / item code / name…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <FilterSelect label="Status" value={filters.status} options={f?.status} onChange={setFilter("status")} format={statusLabel} />
        <FilterSelect label="Group" value={filters.group} options={f?.group} onChange={setFilter("group")} />
        <FilterSelect label="Business" value={filters.business} options={f?.business} onChange={setFilter("business")} />
        <FilterSelect label="UOM" value={filters.uomType} options={f?.uomType} onChange={setFilter("uomType")} />
        {filtered && <Button variant="ghost" size="sm" onClick={() => { setQ(""); setDebouncedQ(""); setFilters(NO_FILTERS); setPage(1); }}>Clear</Button>}
      </div>
      {list.isError ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-sm border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Unable to load products. Please try again.
          <Button variant="outline" size="sm" onClick={() => list.refetch()} loading={list.isFetching}>Retry</Button>
        </div>
      ) : (
        <div aria-busy={stale} className={stale ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"}>
          {!!meta?.skipped && <p className="mb-2 text-xs text-amber-800">{meta.skipped} record(s) on this page could not be read and were skipped.</p>}
          <Table<Row>
            rows={(list.data?.data ?? []).map((r) => ({ ...r, _id: r.id }))}
            loading={list.isLoading}
            loadingText="Loading products..."
            empty="No barcode products found."
            onRowClick={(r) => { setError(null); setEditing(r); }}
            columns={[
              { key: "img", label: "", render: (r) => <ProductThumb src={r.image} alt={r.name} issue={r.imageIssue} sizes="36px" className="h-12 w-9" /> },
              { key: "name", label: "Product", render: (r) => <><span className="font-medium">{r.name}</span>{(r.itemName || r.group) && <span className="block text-xs text-muted">{[r.itemName, r.group].filter(Boolean).join(" · ")}</span>}</> },
              { key: "barcode", label: "Barcode", render: (r) => <><Barcode value={r.barcode} height={26} className="text-ink" />{r.barcodeLabelCount ? <span className="block text-[11px] text-amber-800">on {r.barcodeLabelCount} labels</span> : null}</> },
              { key: "code", label: "Item code", render: (r) => <>{r.itemCode && <span className="font-mono text-xs">{r.itemCode}</span>}{r.oldBarcode && <span className="block font-mono text-[11px] text-muted">old {r.oldBarcode}</span>}</> },
              { key: "qty", label: "Qty", render: (r) => fmtQty(r) },
              { key: "price", label: "Price", render: (r) => <>{r.price != null && formatINR(r.price)}{r.offerPrice != null && r.offerPrice !== r.price && <span className="block text-xs text-muted">offer {formatINR(r.offerPrice)}</span>}</> },
              { key: "status", label: "Status", render: (r) => <>{r.status && <Badge tone={STATUS_TONE[r.status] ?? "muted"}>{statusLabel(r.status)}</Badge>}{r.business && <span className="mt-1 block text-[11px] text-muted">{r.business}</span>}</> },
              { key: "web", label: "Web", render: (r) => r.web?.isFeatured ? <Badge tone="gold">featured</Badge> : null },
            ]}
          />
          <Pager page={page} pages={meta?.pages ?? 1} onChange={setPage} />
        </div>
      )}
      <Drawer open={!!editing} onClose={() => setEditing(null)} title="Barcode product" className="max-w-xl">
        {editing && (
          <div className="space-y-5 p-5">
            <div className="flex gap-4">
              <ProductThumb src={editing.image} alt={editing.name} issue={editing.imageIssue} sizes="128px" className="h-40 w-28" />
              <div className="min-w-0">
                <p className="font-medium">{editing.name}</p>
                {editing.itemName && <p className="text-xs text-muted">{editing.itemName}</p>}
                <Barcode value={editing.barcode} height={48} moduleWidth={2} className="mt-3 text-ink" />
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {([
                ["Item code", editing.itemCode],
                ["Old barcode", editing.oldBarcode],
                ["Print description", editing.printDescription],
                ["Group", editing.group],
                ["Business", editing.business],
                ["Quantity", fmtQty(editing)],
                ["Retail price", editing.price != null ? formatINR(editing.price) : undefined],
                ["Offer price", editing.offerPrice != null ? formatINR(editing.offerPrice) : undefined],
                ["HSN", editing.hsnCode],
                ["GST", editing.gstPercent != null ? `${editing.gstPercent}%` : undefined],
                ["Status", editing.status && statusLabel(editing.status)],
                ["Batch type", editing.batchType],
                ["GRC no.", editing.grcNo],
                ["Created", fmtDate(editing.createdAt)],
                ["Updated", fmtDate(editing.updatedAt)],
              ] as [string, string | null | undefined][]).filter(([, v]) => v).map(([k, v]) => (
                <div key={k}><dt className="text-[10px] uppercase tracking-[0.18em] text-muted">{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
            <div>
              <h3 className="mb-3 text-xs uppercase tracking-[0.18em] text-muted">Web settings</h3>
              {editing.barcodeLabelCount ? (
                <p className="mb-3 rounded-sm border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                  Barcode {editing.barcode} is on {editing.barcodeLabelCount} RetailERP labels. Web settings are stored per barcode, so they apply to all of them.
                </p>
              ) : null}
              <SpecForm
                key={editing.id}
                mode="edit"
                initial={{ slug: editing.web?.slug ?? editing.slug, seoTitle: editing.web?.seoTitle ?? "", seoDescription: editing.web?.seoDescription ?? "", isFeatured: editing.web?.isFeatured ?? false }}
                fields={[
                  { name: "slug", label: "URL slug", type: "text", full: true, hint: `/products/<slug>` },
                  { name: "seoTitle", label: "SEO title", type: "text", full: true },
                  { name: "seoDescription", label: "SEO description", type: "textarea" },
                  { name: "isFeatured", label: "Featured", type: "boolean" },
                ]}
                onSubmit={(v) => save.mutate(v)}
                busy={save.isPending}
                error={error}
              />
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

"use client";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { BarcodeFacets, BarcodeProduct, FacetOption } from "@/domain/types";
import { api } from "@/hooks/api";
import { formatINR } from "@/lib/utils";
import { PageHeader, Pager, Table } from "@/components/admin/table";
import { ProductThumb } from "@/components/admin/product-thumb";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Barcode } from "@/components/ui/barcode";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field, Input, Select } from "@/components/ui/input";

type Row = BarcodeProduct & {
  _id: string;
  web: {
    slug: string;
    seoTitle?: string;
    seoDescription?: string;
    itemName?: string;
    barcodeName?: string;
    barcodePriceOverride?: number;
    barcodeQtyOverride?: number;
    barcodeStatusOverride?: string;
    isFeatured?: boolean;
    salesCount?: number;
  } | null;
};
type Filters = { status: string; group: string; business: string; uomType: string };
type ProductEditValues = { itemName: string; barcodeName: string; price: string; quantity: string; status: string };

const NO_FILTERS: Filters = { status: "", group: "", business: "", uomType: "" };
const STATUS_TONE: Record<string, BadgeTone> = { IN_STOCK: "green", IN_TRANSIT: "blue", SOLD: "muted", HISTORY: "muted", VOID: "red" };
const statusLabel = (s: string) => s.toLowerCase().replace(/_/g, " ");
const effectivePrice = (row: Row) => row.web?.barcodePriceOverride ?? row.price;
const effectiveQty = (row: Row) => row.web?.barcodeQtyOverride ?? row.qty;
const effectiveStatus = (row: Row) => row.web?.barcodeStatusOverride ?? row.status;
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
  const [itemName, setItemName] = useState("");
  const [barcodeName, setBarcodeName] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [status, setStatus] = useState("");
  const [initialEditValues, setInitialEditValues] = useState<ProductEditValues>({
    itemName: "",
    barcodeName: "",
    price: "",
    quantity: "",
    status: "",
  });
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
    mutationFn: () => api("/api/v1/admin/products", {
      method: "PATCH",
      json: {
        sku: editing!.barcode,
        ...(itemName !== initialEditValues.itemName ? { itemName: itemName.trim() || null } : {}),
        ...(barcodeName !== initialEditValues.barcodeName ? { barcodeName: barcodeName.trim() || null } : {}),
        ...(price !== initialEditValues.price ? { barcodePriceOverride: price.trim() ? Number(price) : null } : {}),
        ...(quantity !== initialEditValues.quantity ? { barcodeQtyOverride: quantity.trim() ? Number(quantity) : null } : {}),
        ...(status !== initialEditValues.status ? { barcodeStatusOverride: status || null } : {}),
      },
    }),
    onSuccess: () => {
      setEditing(null);
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin", "products"] });
    },
    onError: (e) => setError((e as Error).message),
  });

  return (
    <div>
      <PageHeader title="Products" subtitle={meta?.total != null ? `${meta.total.toLocaleString("en-IN")} ${filtered ? "matching " : ""}barcode labels · source: RetailERP barcodeLabel (read-only)` : undefined}>
        <Badge tone="green">Synced from RetailERP</Badge>
      </PageHeader>
      <p className="mb-4 rounded-sm border border-gold/40 bg-gold/5 p-3 text-xs text-ink/80">
        Barcode and item code stay as supplied by RetailERP. Item name, barcode name, price, quantity and status changes are saved as website overrides.
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
            columns={[
              { key: "img", label: "", render: (r) => <ProductThumb src={r.image} alt={r.name} issue={r.imageIssue} sizes="36px" className="h-12 w-9" /> },
              { key: "name", label: "Product", render: (r) => {
                const primaryName = r.web?.itemName || r.web?.barcodeName || r.name;
                const secondaryName = r.web?.itemName && r.web?.barcodeName ? r.web.barcodeName : null;
                return <><span className="font-medium">{primaryName}</span>{secondaryName && <span className="block text-xs text-muted">{secondaryName}</span>}{r.group && <span className="block text-xs text-muted">{r.group}</span>}</>;
              } },
              { key: "barcode", label: "Barcode", render: (r) => <><Barcode value={r.barcode} height={26} className="text-ink" />{r.barcodeLabelCount ? <span className="block text-[11px] text-amber-800">on {r.barcodeLabelCount} labels</span> : null}</> },
              { key: "code", label: "Item code", render: (r) => <>{r.itemCode && <span className="font-mono text-xs">{r.itemCode}</span>}{r.oldBarcode && <span className="block font-mono text-[11px] text-muted">old {r.oldBarcode}</span>}</> },
              { key: "qty", label: "Qty", render: (r) => {
                const qty = effectiveQty(r);
                return qty == null ? null : `${qty.toLocaleString("en-IN", { maximumFractionDigits: 3 })}${r.uom ? ` ${r.uom}` : ""}`;
              } },
              { key: "price", label: "Price", render: (r) => {
                const amount = effectivePrice(r);
                return <>{amount != null && formatINR(amount)}{r.offerPrice != null && r.offerPrice !== amount && <span className="block text-xs text-muted">offer {formatINR(r.offerPrice)}</span>}</>;
              } },
              { key: "status", label: "Status", render: (r) => {
                const value = effectiveStatus(r);
                return <>{value && <Badge tone={STATUS_TONE[value] ?? "muted"}>{statusLabel(value)}</Badge>}{r.business && <span className="mt-1 block text-[11px] text-muted">{r.business}</span>}</>;
              } },
              { key: "edit", label: "Action", render: (r) => <Button size="sm" variant="outline" onClick={() => {
                setError(null);
                setEditing(r);
                const values = {
                  itemName: r.web?.itemName ?? "",
                  barcodeName: r.web?.barcodeName ?? "",
                  price: String(effectivePrice(r) ?? ""),
                  quantity: String(effectiveQty(r) ?? ""),
                  status: r.web?.barcodeStatusOverride ?? "",
                };
                setInitialEditValues(values);
                setItemName(values.itemName);
                setBarcodeName(values.barcodeName);
                setPrice(values.price);
                setQuantity(values.quantity);
                setStatus(values.status);
              }}>Edit</Button> },
            ]}
          />
          <Pager page={page} pages={meta?.pages ?? 1} onChange={setPage} />
        </div>
      )}
      <Drawer open={!!editing} onClose={() => setEditing(null)} title="Edit product" className="max-w-xl">
        {editing && (
          <form className="space-y-5 p-5" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
            <div className="flex gap-4">
              <ProductThumb src={editing.image} alt={editing.name} issue={editing.imageIssue} sizes="128px" className="h-40 w-28" />
              <div className="min-w-0">
                <p className="font-medium">{editing.web?.itemName || editing.web?.barcodeName || editing.name}</p>
                <p className="text-xs text-muted">Barcode {editing.barcode}</p>
                <Barcode value={editing.barcode} height={48} moduleWidth={2} className="mt-3 text-ink" />
              </div>
            </div>
            {editing.barcodeLabelCount ? (
              <p className="rounded-sm border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                This barcode appears on {editing.barcodeLabelCount} ERP labels; website overrides apply to all matching labels. Barcode and item code remain unchanged.
              </p>
            ) : null}
            <Field label="Item name">
              <Input maxLength={160} value={itemName} onChange={(event) => setItemName(event.target.value)} />
            </Field>
            <Field label="Barcode name">
              <Input maxLength={160} value={barcodeName} onChange={(event) => setBarcodeName(event.target.value)} />
            </Field>
            <Field label="Price (₹)">
              <Input type="number" min="0" step="0.01" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
            </Field>
            <Field label={`Quantity${editing.uom ? ` (${editing.uom})` : ""}`}>
              <Input type="number" min="0" step="0.001" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            </Field>
            <Field label="Status">
              <Select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">Use ERP status{editing.status ? ` (${statusLabel(editing.status)})` : ""}</option>
                {["IN_STOCK", "IN_TRANSIT", "SOLD", "HISTORY", "VOID"].map((value) => (
                  <option key={value} value={value}>{statusLabel(value)}</option>
                ))}
              </Select>
            </Field>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <Button type="submit" loading={save.isPending}>Save changes</Button>
          </form>
        )}
      </Drawer>
    </div>
  );
}

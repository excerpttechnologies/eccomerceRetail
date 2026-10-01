"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ProductCard } from "@/domain/types";
import { api } from "@/hooks/api";
import { PageHeader, Stat, Table } from "@/components/admin/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Inv { summary: { total: number; inStock: number; lowStock: number; outOfStock: number }; threshold: number; dataSource: string; lastSyncAt?: string | null; lastSyncStatus?: string | null; lowStock: ProductCard[]; outOfStock: ProductCard[] }

export default function InventoryPage() {
  const inv = useQuery({ queryKey: ["admin", "inventory"], queryFn: async () => (await api<Inv>("/api/v1/admin/inventory")).data });
  const [msg, setMsg] = useState<string | null>(null);
  const test = useMutation({ mutationFn: async () => (await api<{ ok: boolean; dataSource: string; dbName?: string; collections?: string[]; latencyMs?: number; error?: string }>("/api/v1/admin/erp/test", { method: "POST" })).data, onSuccess: (r) => setMsg(r.ok ? `Connected to ${r.dataSource === "erp" ? "RetailERP" : "mock DB"} (${r.dbName}) in ${r.latencyMs}ms · ${r.collections?.length ?? 0} collections` : `Connection failed: ${r.error}`), onError: (e) => setMsg((e as Error).message) });
  const sync = useMutation({ mutationFn: async () => (await api<{ scanned: number; created: number; ms: number }>("/api/v1/admin/erp/sync-meta", { method: "POST" })).data, onSuccess: (r) => { setMsg(`Re-sync done: ${r.scanned} products scanned, ${r.created} new slugs in ${r.ms}ms`); inv.refetch(); }, onError: (e) => setMsg((e as Error).message) });
  const d = inv.data;
  const cols = [
    { key: "sku", label: "Item Code", className: "font-mono text-xs" },
    { key: "name", label: "Product" },
    { key: "category", label: "Category" },
    { key: "qty", label: "Qty", render: (r: ProductCard) => <Badge tone={r.stock.qty <= 0 ? "red" : "amber"}>{r.stock.qty}</Badge> },
  ];
  return (
    <div>
      <PageHeader title="Inventory & RetailERP sync" subtitle="Stock and prices are read live from master data on every request — there is nothing to import. “Re-sync” only creates website slugs/SEO rows for new item codes.">
        <Button variant="outline" size="sm" loading={test.isPending} onClick={() => test.mutate()}>Test ERP connection</Button>
        <Button variant="secondary" size="sm" loading={sync.isPending} onClick={() => sync.mutate()}>Re-sync web meta</Button>
      </PageHeader>
      {msg && <p className="mb-4 rounded-sm border border-line bg-ivory p-3 text-xs">{msg}</p>}
      {d && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Active Item Codes" value={d.summary.total} sub={d.dataSource === "erp" ? "RetailERP" : "mock catalogue"} />
            <Stat label="In stock" value={d.summary.inStock} />
            <Stat label={`Low (≤ ${d.threshold})`} value={d.summary.lowStock} tone="gold" />
            <Stat label="Out of stock" value={d.summary.outOfStock} tone="maroon" />
          </div>
          <p className="mt-3 text-xs text-muted">Last web-meta sync: {d.lastSyncAt ? new Date(d.lastSyncAt).toLocaleString("en-IN") : "never"}{d.lastSyncStatus ? ` · ${d.lastSyncStatus}` : ""}</p>
          <h2 className="mb-2 mt-8 text-2xl">Low stock</h2>
          <Table rows={d.lowStock.map((p) => ({ ...p, _id: p.id }))} columns={cols} empty="Nothing running low." />
          <h2 className="mb-2 mt-8 text-2xl">Out of stock</h2>
          <Table rows={d.outOfStock.map((p) => ({ ...p, _id: p.id }))} columns={cols} empty="Everything is in stock." />
        </>
      )}
    </div>
  );
}

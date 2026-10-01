"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "@/hooks/api";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Input, Select } from "@/components/ui/input";
import { SpecForm, type FieldSpec } from "./form";
import { Column, PageHeader, Pager, Table } from "./table";

export interface ResourcePageProps<T> {
  resource: string;
  title: string;
  subtitle?: string;
  columns: Column<T>[];
  fields: FieldSpec[];
  filters?: { key: string; label: string; options: { value: string; label: string }[] }[];
  canCreate?: boolean;
  canDelete?: boolean;
  defaults?: Partial<T>;
  /** Extra row actions (e.g. approve/reject) */
  rowActions?: (row: T, mutate: (id: string, patch: any) => void) => React.ReactNode;
  sort?: string;
  limit?: number;
}

export function useAdminList<T>(resource: string, params: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();
  return useQuery({ queryKey: ["admin", resource, qs], queryFn: async () => api<T[]>(`/api/v1/admin/${resource}?${qs}`) });
}

export function ResourcePage<T extends { _id: string }>({ resource, title, subtitle, columns, fields, filters, canCreate = true, canDelete = true, defaults, rowActions, sort, limit = 50 }: ResourcePageProps<T>) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<T | null | "new">(null);
  const [error, setError] = useState<string | null>(null);
  const list = useAdminList<T>(resource, { q, page, limit, sort, ...Object.fromEntries(Object.entries(filter).map(([k, v]) => [`filter[${k}]`, v])) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", resource] });
  const save = useMutation({
    mutationFn: async (v: any) => (editing === "new" ? api(`/api/v1/admin/${resource}`, { method: "POST", json: v }) : api(`/api/v1/admin/${resource}/${(editing as T)._id}`, { method: "PATCH", json: strip(v) })),
    onSuccess: () => { setEditing(null); setError(null); invalidate(); },
    onError: (e) => setError(e instanceof ApiError ? `${e.message}${e.details ? " — " + JSON.stringify((e.details as { fieldErrors?: unknown }).fieldErrors ?? e.details) : ""}` : String(e)),
  });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: any }) => api(`/api/v1/admin/${resource}/${id}`, { method: "PATCH", json: body }), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/v1/admin/${resource}/${id}`, { method: "DELETE" }), onSuccess: () => { setEditing(null); invalidate(); } });
  const meta = list.data?.meta as { pages?: number } | undefined;

  const cols: Column<T>[] = [...columns];
  if (rowActions) cols.push({ key: "__actions", label: "", className: "text-right", render: (r) => <span onClick={(e) => e.stopPropagation()}>{rowActions(r, (id, body) => patch.mutate({ id, body }))}</span> });

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle}>
        {canCreate && <Button size="sm" onClick={() => { setError(null); setEditing("new"); }}><Plus className="h-4 w-4" /> New</Button>}
      </PageHeader>
      <div className="mb-3 flex flex-wrap gap-2">
        <Input placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="max-w-xs" />
        {filters?.map((f) => (
          <Select key={f.key} value={filter[f.key] ?? ""} onChange={(e) => { setFilter({ ...filter, [f.key]: e.target.value }); setPage(1); }} className="w-auto">
            <option value="">{f.label}: all</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        ))}
      </div>
      <Table rows={list.data?.data ?? []} columns={cols} loading={list.isLoading} onRowClick={(r) => { setError(null); setEditing(r); }} />
      <Pager page={page} pages={meta?.pages ?? 1} onChange={setPage} />

      <Drawer open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? `New ${title.replace(/s$/, "").toLowerCase()}` : `Edit`} className="max-w-2xl">
        <div className="p-5">
          {editing !== null && (
            <SpecForm key={editing === "new" ? "new" : (editing as T)._id} mode={editing === "new" ? "create" : "edit"} fields={fields} initial={editing === "new" ? (defaults ?? {}) : editing} onSubmit={(v) => save.mutate(v)} busy={save.isPending} error={error} />
          )}
          {editing && editing !== "new" && canDelete && (
            <button onClick={() => confirm("Delete this item?") && remove.mutate((editing as T)._id)} className="mt-6 flex items-center gap-1 text-xs uppercase tracking-widest text-red-700"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
          )}
        </div>
      </Drawer>
    </div>
  );
}

/** Remove server-managed fields before PATCH. */
function strip(v: any) {
  const { _id, __v, createdAt, updatedAt, ...rest } = v;
  return rest;
}

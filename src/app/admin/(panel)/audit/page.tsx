"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/hooks/api";
import { PageHeader, Pager, Table } from "@/components/admin/table";
import { Badge } from "@/components/ui/badge";

interface Log { _id: string; actorEmail: string; action: string; entity: string; entityId?: string; ip?: string; createdAt: string; before?: unknown; after?: unknown }

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Log | null>(null);
  const list = useQuery({ queryKey: ["admin", "audit", page], queryFn: () => api<Log[]>(`/api/v1/admin/audit?page=${page}`) });
  const meta = list.data?.meta as { pages?: number } | undefined;
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Every admin write, with before/after snapshots." />
      <Table<Log> rows={list.data?.data ?? []} loading={list.isLoading} onRowClick={setOpen} columns={[
        { key: "createdAt", label: "When", render: (l) => new Date(l.createdAt).toLocaleString("en-IN") },
        { key: "actorEmail", label: "Who", className: "text-xs" },
        { key: "action", label: "Action", render: (l) => <Badge tone="olive">{l.action}</Badge> },
        { key: "entity", label: "Entity", render: (l) => <>{l.entity}<span className="block font-mono text-xs text-muted">{l.entityId}</span></> },
        { key: "ip", label: "IP", className: "text-xs text-muted" },
      ]} />
      <Pager page={page} pages={meta?.pages ?? 1} onChange={setPage} />
      {open && (
        <div className="mt-4 grid gap-3 rounded-sm border border-line p-4 text-xs md:grid-cols-2">
          <div><p className="mb-1 uppercase tracking-widest text-muted">Before</p><pre className="max-h-72 overflow-auto rounded-sm bg-ivory p-2">{JSON.stringify(open.before ?? null, null, 2)}</pre></div>
          <div><p className="mb-1 uppercase tracking-widest text-muted">After</p><pre className="max-h-72 overflow-auto rounded-sm bg-ivory p-2">{JSON.stringify(open.after ?? null, null, 2)}</pre></div>
        </div>
      )}
    </div>
  );
}

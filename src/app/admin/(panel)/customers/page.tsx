"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Customer } from "@/domain/types";
import { api } from "@/hooks/api";
import { PageHeader, Pager, Table } from "@/components/admin/table";
import { Input } from "@/components/ui/input";

export default function CustomersPage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ q, page: String(page) }).toString();
  const list = useQuery({ queryKey: ["admin", "customers", qs], queryFn: () => api<Customer[]>(`/api/v1/admin/customers?${qs}`) });
  const meta = list.data?.meta as { pages?: number; total?: number } | undefined;
  return (
    <div>
      <PageHeader title="Customers" subtitle={meta ? `${meta.total} customers (website + RetailERP-shaped)` : undefined} />
      <Input placeholder="Name / mobile / email…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="mb-3 max-w-xs" />
      <Table<Customer & { _id: string }>
        rows={(list.data?.data ?? []).map((c) => ({ ...c, _id: c.id }))}
        loading={list.isLoading}
        columns={[
          { key: "name", label: "Name", render: (c) => <span className="font-medium">{c.name || "—"}</span> },
          { key: "mobile", label: "Mobile" },
          { key: "email", label: "Email", className: "text-xs" },
          { key: "addresses", label: "City", render: (c) => c.addresses.find((a) => a.isDefault)?.city ?? c.addresses[0]?.city ?? "" },
          { key: "loyaltyPoints", label: "Points" },
          { key: "createdAt", label: "Since", render: (c) => (c.createdAt ? new Date(c.createdAt).toLocaleDateString("en-IN") : "") },
        ]}
      />
      <Pager page={page} pages={meta?.pages ?? 1} onChange={setPage} />
    </div>
  );
}

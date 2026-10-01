"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { Order } from "@/domain/types";
import { api } from "@/hooks/api";
import { formatINR } from "@/lib/utils";
import { PageHeader, Pager, Table } from "@/components/admin/table";
import { orderTone } from "@/components/account/order-status";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";

const STATUSES = ["Placed", "Confirmed", "Packed", "Shipped", "Delivered", "Cancelled", "Returned"];

export default function OrdersPage() {
  return <Suspense><OrdersInner /></Suspense>;
}

function OrdersInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const status = sp.get("status") ?? "";
  const qs = new URLSearchParams({ q, page: String(page), ...(status ? { status } : {}) }).toString();
  const list = useQuery({ queryKey: ["admin", "orders", qs], queryFn: () => api<Order[]>(`/api/v1/admin/orders?${qs}`) });
  const meta = list.data?.meta as { pages?: number; total?: number } | undefined;
  return (
    <div>
      <PageHeader title="Orders" subtitle={meta ? `${meta.total} orders` : undefined} />
      <div className="mb-3 flex gap-2">
        <Input placeholder="Order no / phone / name…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="max-w-xs" />
        <Select value={status} onChange={(e) => { router.push(`/admin/orders${e.target.value ? `?status=${e.target.value}` : ""}`); setPage(1); }} className="w-auto"><option value="">Status: all</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</Select>
      </div>
      <Table<Order & { _id: string }>
        rows={(list.data?.data ?? []).map((o) => ({ ...o, _id: o.id }))}
        loading={list.isLoading}
        onRowClick={(o) => router.push(`/admin/orders/${o.orderNo}`)}
        columns={[
          { key: "orderNo", label: "Order", render: (o) => <><span className="font-medium">{o.orderNo}</span><span className="block text-xs text-muted">{o.createdAt ? new Date(o.createdAt).toLocaleString("en-IN") : ""}</span></> },
          { key: "customer", label: "Customer", render: (o) => <>{o.shippingAddress.name}<span className="block text-xs text-muted">{o.shippingAddress.phone} · {o.shippingAddress.city}</span></> },
          { key: "items", label: "Items", render: (o) => o.items.reduce((n, i) => n + i.qty, 0) },
          { key: "netAmount", label: "Total", render: (o) => formatINR(o.netAmount) },
          { key: "paymentMode", label: "Payment", render: (o) => <>{o.paymentMode}<span className="block text-xs text-muted">{o.paymentStatus}</span></> },
          { key: "orderStatus", label: "Status", render: (o) => <Badge tone={orderTone(o.orderStatus)}>{o.orderStatus}</Badge> },
        ]}
      />
      <Pager page={page} pages={meta?.pages ?? 1} onChange={setPage} />
    </div>
  );
}

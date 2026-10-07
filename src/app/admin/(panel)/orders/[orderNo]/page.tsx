"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import type { Customer, Order } from "@/domain/types";
import { api } from "@/hooks/api";
import { formatINR } from "@/lib/utils";
import { PageHeader } from "@/components/admin/table";
import { OrderTimeline, orderTone } from "@/components/account/order-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";

type Detail = Order & { customer: Customer | null; allowedTransitions: string[]; staffLinks?: Record<string, string> };

export default function OrderDetail() {
  const { orderNo } = useParams<{ orderNo: string }>();
  const qc = useQueryClient();
  const { data: o, error } = useQuery({ queryKey: ["admin", "order", orderNo], queryFn: async () => (await api<Detail>(`/api/v1/admin/orders/${orderNo}`)).data });
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [awb, setAwb] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: () => api(`/api/v1/admin/orders/${orderNo}`, { method: "PATCH", json: { status: status || undefined, note: note || undefined, awbNo: awb || undefined } }),
    onSuccess: () => { setStatus(""); setNote(""); setAwb(""); setMsg("Updated"); qc.invalidateQueries({ queryKey: ["admin", "order", orderNo] }); qc.invalidateQueries({ queryKey: ["admin", "orders"] }); },
    onError: (e) => setMsg((e as Error).message),
  });
  if (error) return <p className="text-sm text-red-700">{(error as Error).message}</p>;
  if (!o) return <p className="text-sm text-muted">Loading…</p>;
  const a = o.shippingAddress;
  return (
    <div>
      <PageHeader title={o.orderNo} subtitle={`${o.createdAt ? new Date(o.createdAt).toLocaleString("en-IN") : ""} · ${o.paymentMode} · payment ${o.paymentStatus}${o.couponCode ? ` · coupon ${o.couponCode}` : ""}`}>
        <Badge tone={orderTone(o.orderStatus)}>{o.orderStatus}</Badge>
        <Link href="/admin/orders" className="text-xs uppercase tracking-widest text-muted hover:text-olive">← All orders</Link>
      </PageHeader>
      <div className="rounded-sm border border-line p-4"><OrderTimeline status={o.orderStatus} /></div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] uppercase tracking-widest text-muted"><tr><th className="py-1">Item</th><th>Qty</th><th>Rate</th><th className="text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-line">
              {o.items.map((it) => <tr key={it.sku}><td className="py-2">{it.name}<span className="block font-mono text-xs text-muted">Item Code: {it.sku}</span></td><td>{it.qty}</td><td>{formatINR(it.rate)}</td><td className="text-right">{formatINR(it.amount)}</td></tr>)}
            </tbody>
            <tfoot className="text-sm">
              <tr><td colSpan={3} className="pt-3 text-right text-muted">Subtotal</td><td className="pt-3 text-right">{formatINR(o.subTotal)}</td></tr>
              {o.discountTotal > 0 && <tr><td colSpan={3} className="text-right text-muted">Discount</td><td className="text-right">− {formatINR(o.discountTotal)}</td></tr>}
              <tr><td colSpan={3} className="text-right text-muted">Shipping</td><td className="text-right">{formatINR(o.shippingCharge)}</td></tr>
              <tr><td colSpan={3} className="text-right text-muted">GST (included)</td><td className="text-right">{formatINR(o.gstTotal)}</td></tr>
              <tr className="font-medium"><td colSpan={3} className="text-right">Total</td><td className="text-right">{formatINR(o.netAmount)}</td></tr>
            </tfoot>
          </table>
          {(o.statusHistory?.length ?? 0) > 0 && (
            <div>
              <p className="mb-2 text-[10px] uppercase tracking-widest text-muted">History</p>
              <ul className="space-y-1 text-xs">{[...(o.statusHistory ?? [])].reverse().map((historyEntry, index) => {
                const staffId = historyEntry.by ? o.staffLinks?.[historyEntry.by.toLowerCase()] : undefined;
                return <li key={index}><b>{historyEntry.status}</b> · {historyEntry.at ? new Date(historyEntry.at).toLocaleString("en-IN") : ""}{historyEntry.by ? <> · {staffId ? <Link href={`/admin/staff/${staffId}`} className="text-olive underline underline-offset-2">{historyEntry.by}</Link> : historyEntry.by}</> : null}{historyEntry.note ? ` — ${historyEntry.note}` : ""}</li>;
              })}</ul>
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div className="rounded-sm border border-line p-4 text-sm">
            <p className="mb-1 text-[10px] uppercase tracking-widest text-muted">Customer</p>
            <p className="font-medium">{o.customer?.name ?? a.name}</p>
            <p className="text-muted">{o.customer?.mobile ?? a.phone}{o.customer?.email ? ` · ${o.customer.email}` : ""}</p>
            <p className="mt-3 mb-1 text-[10px] uppercase tracking-widest text-muted">Ship to</p>
            <p>{a.line1}{a.line2 ? `, ${a.line2}` : ""}<br />{a.city}, {a.state} {a.pincode}<br />{a.phone}</p>
            {o.awbNo && <p className="mt-3 text-xs">AWB: <b>{o.awbNo}</b></p>}
          </div>
          <form className="space-y-3 rounded-sm border border-line p-4" onSubmit={(e) => { e.preventDefault(); update.mutate(); }}>
            <p className="text-[10px] uppercase tracking-widest text-muted">Update</p>
            <Field label="Move to"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">— keep {o.orderStatus} —</option>{o.allowedTransitions.map((s) => <option key={s}>{s}</option>)}</Select></Field>
            <Field label="AWB / tracking no"><Input value={awb} onChange={(e) => setAwb(e.target.value)} placeholder={o.awbNo ?? ""} /></Field>
            <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <Button type="submit" size="sm" loading={update.isPending} disabled={!status && !awb && !note}>Save</Button>
            {msg && <p className="text-xs text-muted">{msg}</p>}
          </form>
        </div>
      </div>
    </div>
  );
}

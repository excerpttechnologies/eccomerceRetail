"use client";
import { Badge } from "@/components/ui/badge";
import { ResourcePage } from "@/components/admin/resource-page";

interface R { _id: string; sku: string; customerName: string; rating: number; title?: string; body: string; status: "pending" | "approved" | "rejected"; isVerifiedPurchase?: boolean; createdAt?: string }
const tone = { pending: "amber", approved: "green", rejected: "red" } as const;

export default function ReviewsPage() {
  return (
    <ResourcePage<R>
      resource="reviews"
      title="Reviews"
      subtitle="Only approved reviews are shown on product pages."
      canCreate={false}
      filters={[{ key: "status", label: "Status", options: ["pending", "approved", "rejected"].map((v) => ({ value: v, label: v })) }]}
      columns={[
        { key: "createdAt", label: "Date", render: (r) => (r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-IN") : "") },
        { key: "sku", label: "Item Code", className: "font-mono text-xs" },
        { key: "customerName", label: "Customer", render: (r) => <>{r.customerName}{r.isVerifiedPurchase && <Badge tone="olive" className="ml-2">verified</Badge>}</> },
        { key: "rating", label: "Rating", render: (r) => "★".repeat(r.rating) },
        { key: "body", label: "Review", render: (r) => <span className="line-clamp-2 text-xs">{r.title ? <b>{r.title} — </b> : null}{r.body}</span> },
        { key: "status", label: "Status", render: (r) => <Badge tone={tone[r.status]}>{r.status}</Badge> },
      ]}
      fields={[
        { name: "status", label: "Status", type: "select", options: ["pending", "approved", "rejected"].map((v) => ({ value: v, label: v })) },
        { name: "title", label: "Title", type: "text" },
        { name: "body", label: "Body", type: "textarea" },
      ]}
      rowActions={(r, mutate) => (
        <span className="flex justify-end gap-2 text-xs uppercase tracking-widest">
          {r.status !== "approved" && <button onClick={() => mutate(r._id, { status: "approved" })} className="text-olive">Approve</button>}
          {r.status !== "rejected" && <button onClick={() => mutate(r._id, { status: "rejected" })} className="text-red-700">Reject</button>}
        </span>
      )}
    />
  );
}

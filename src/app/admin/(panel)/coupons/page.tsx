"use client";
import { Badge } from "@/components/ui/badge";
import { ResourcePage } from "@/components/admin/resource-page";

interface C { _id: string; code: string; type: string; value: number; minCart: number; usedCount: number; usageLimit?: number | null; validTo?: string | null; isActive: boolean }

export default function CouponsPage() {
  return (
    <ResourcePage<C>
      resource="coupons"
      title="Coupons"
      columns={[
        { key: "code", label: "Code", render: (r) => <span className="font-mono font-medium">{r.code}</span> },
        { key: "type", label: "Type", render: (r) => <Badge tone="gold">{r.type}</Badge> },
        { key: "value", label: "Value", render: (r) => (r.type === "percent" ? `${r.value}%` : r.type === "flat" ? `₹${r.value}` : `buy ${r.value}`) },
        { key: "minCart", label: "Min cart", render: (r) => `₹${r.minCart ?? 0}` },
        { key: "usedCount", label: "Used", render: (r) => `${r.usedCount ?? 0}${r.usageLimit ? ` / ${r.usageLimit}` : ""}` },
        { key: "validTo", label: "Valid to", render: (r) => (r.validTo ? new Date(r.validTo).toLocaleDateString("en-IN") : "—") },
        { key: "isActive", label: "Active", render: (r) => <Badge tone={r.isActive ? "green" : "muted"}>{r.isActive ? "yes" : "no"}</Badge> },
      ]}
      fields={[
        { name: "code", label: "Code", type: "text", required: true },
        { name: "type", label: "Type", type: "select", required: true, options: [{ value: "percent", label: "Percent off" }, { value: "flat", label: "Flat ₹ off" }, { value: "bogo", label: "Buy N get 1 (cheapest free)" }] },
        { name: "value", label: "Value", type: "number", required: true },
        { name: "minCart", label: "Minimum cart ₹", type: "number" },
        { name: "maxDiscount", label: "Max discount ₹ (percent)", type: "number" },
        { name: "usageLimit", label: "Total usage limit", type: "number" },
        { name: "perCustomerLimit", label: "Per-customer limit", type: "number" },
        { name: "description", label: "Description", type: "text" },
        { name: "applicableCategories", label: "Applicable categories", type: "tags", hint: "Blank = all. Category names as in RetailERP." },
        { name: "validFrom", label: "Valid from", type: "date" },
        { name: "validTo", label: "Valid to", type: "date" },
        { name: "isActive", label: "Active", type: "boolean" },
      ]}
      defaults={{ type: "percent", isActive: true, minCart: 0 }}
    />
  );
}

"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/hooks/api";
import { PageHeader } from "@/components/admin/table";
import { SpecForm, type FieldSpec } from "@/components/admin/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";

const TABS: { key: string; label: string; fields: FieldSpec[] }[] = [
  {
    key: "brand", label: "Brand & theme",
    fields: [
      { name: "storeName", label: "Store name", type: "text", required: true },
      { name: "legalName", label: "Legal name", type: "text" },
      { name: "tagline", label: "Tagline", type: "text", full: true },
      { name: "logo.light", label: "Logo (on ivory)", type: "image", hint: "Upload your final logo to /public or a CDN and paste the URL. A text wordmark is used until then." },
      { name: "logo.dark", label: "Logo (on olive)", type: "image" },
      { name: "logo.favicon", label: "Favicon", type: "image" },
      { name: "theme.ivory", label: "Background (ivory)", type: "color" },
      { name: "theme.olive", label: "Headings (olive)", type: "color" },
      { name: "theme.gold", label: "Accent (gold)", type: "color" },
      { name: "theme.maroon", label: "CTA (maroon)", type: "color" },
      { name: "theme.ink", label: "Body text", type: "color" },
      { name: "theme.muted", label: "Muted text", type: "color" },
      { name: "theme.line", label: "Borders", type: "color" },
    ],
  },
  {
    key: "contact", label: "Contact & social",
    fields: [
      { name: "whatsappNumber", label: "WhatsApp number (digits, with country code)", type: "text", placeholder: "919876543210" },
      { name: "contact.phone", label: "Phone", type: "text" },
      { name: "contact.email", label: "Email", type: "text" },
      { name: "contact.hours", label: "Hours", type: "text" },
      { name: "contact.address", label: "Address", type: "textarea" },
      { name: "social.instagram", label: "Instagram URL", type: "text" },
      { name: "social.facebook", label: "Facebook URL", type: "text" },
      { name: "social.youtube", label: "YouTube URL", type: "text" },
      { name: "defaultStoreId", label: "Default store id (RetailERP)", type: "text" },
    ],
  },
  {
    key: "commerce", label: "Commerce",
    fields: [
      { name: "commerce.freeShippingAbove", label: "Free shipping above ₹", type: "number" },
      { name: "commerce.shippingCharge", label: "Shipping charge ₹", type: "number" },
      { name: "commerce.lowStockThreshold", label: "Low-stock threshold", type: "number" },
      { name: "commerce.codEnabled", label: "Cash on delivery", type: "boolean" },
      { name: "commerce.razorpayEnabled", label: "Razorpay", type: "boolean", hint: "Needs RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in .env; stub mode auto-confirms until then." },
      { name: "commerce.serviceablePincodePrefixes", label: "Serviceable pincode prefixes", type: "tags", hint: "Blank = all India. e.g. 56, 57, 60" },
      { name: "supportedCurrencies", label: "Display currencies", type: "tags", hint: "INR, USD, GBP, AED, EUR (display only; orders bill in INR)" },
    ],
  },
  {
    key: "seo", label: "SEO & trust",
    fields: [
      { name: "seo.defaultTitle", label: "Default title", type: "text", full: true },
      { name: "seo.defaultDescription", label: "Default description", type: "textarea" },
      { name: "seo.ogImage", label: "Open Graph image", type: "image" },
      { name: "trustBadges", label: "Trust badges (JSON)", type: "json", hint: '[{"title":"Handloom certified","text":"…","icon":"award|truck|shield|return|star"}]' },
    ],
  },
];

export default function SettingsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState(TABS[0].key);
  const [erp, setErp] = useState<any>(null);
  const { data } = useQuery({ queryKey: ["admin", "settings"], queryFn: async () => (await api<any>("/api/v1/admin/settings")).data });
  const [msg, setMsg] = useState<string | null>(null);
  const save = useMutation({ mutationFn: (v: any) => api("/api/v1/admin/settings", { method: "PATCH", json: pick(v, TABS.find((t) => t.key === tab)!.fields) }), onSuccess: () => { setMsg("Saved — storefront updates on next request."); qc.invalidateQueries({ queryKey: ["admin", "settings"] }); }, onError: (e) => setMsg((e as Error).message) });
  const test = useMutation({ mutationFn: async () => (await api<any>("/api/v1/admin/erp/test", { method: "POST" })).data, onSuccess: setErp });
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  const cur = TABS.find((t) => t.key === tab)!;
  return (
    <div>
      <PageHeader title="Settings" subtitle="Everything the storefront reads at runtime: theme tokens, logo, contact, commerce rules.">
        <Button variant="outline" size="sm" loading={test.isPending} onClick={() => test.mutate()}>Test RetailERP connection</Button>
      </PageHeader>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => <button key={t.key} onClick={() => { setTab(t.key); setMsg(null); }} className={`px-4 py-2 text-xs uppercase tracking-widest ${tab === t.key ? "border-b-2 border-olive text-olive" : "text-muted"}`}>{t.label}</button>)}
      </div>
      <div className="max-w-3xl">
        <SpecForm key={tab + JSON.stringify(data.updatedAt)} mode="edit" fields={cur.fields} initial={data} onSubmit={(v) => save.mutate(v)} busy={save.isPending} error={null} />
        {msg && <p className="mt-3 text-xs text-olive">{msg}</p>}
      </div>
      <div className="mt-10 rounded-sm border border-line p-4 text-xs">
        <p className="mb-1 text-[10px] uppercase tracking-widest text-muted">RetailERP</p>
        <p>Data source: <Badge tone={data.erp?.dataSource === "erp" ? "green" : "amber"}>{data.erp?.dataSource ?? "mock"}</Badge> · switch with <code>DATA_SOURCE=erp</code> + <code>ERP_MONGODB_URI</code> / <code>ERP_DB_NAME</code> in .env (restart required). Field mapping lives in <code>src/lib/erp-mapping.ts</code>.</p>
        <p className="mt-1 text-muted">Last web-meta sync: {data.erp?.lastSyncAt ? new Date(data.erp.lastSyncAt).toLocaleString("en-IN") : "never"}</p>
      </div>
      <Drawer open={!!erp} onClose={() => setErp(null)} title="Connection test">
        <pre className="overflow-auto p-5 text-xs">{JSON.stringify(erp, null, 2)}</pre>
      </Drawer>
    </div>
  );
}

/** Only send the fields on the active tab (nested groups deep-merge server-side). */
function pick(v: any, fields: FieldSpec[]) {
  const out: any = {};
  for (const f of fields) {
    const [a, b] = f.name.split(".");
    const val = b ? v?.[a]?.[b] : v?.[a];
    if (val === undefined) continue;
    if (b) (out[a] ??= {})[b] = val;
    else out[a] = val;
  }
  return out;
}

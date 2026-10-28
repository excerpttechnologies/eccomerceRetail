"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/hooks/api";
import { PageHeader, Pager, Table } from "@/components/admin/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";

interface Diagnostics {
  enabled: boolean;
  sendConfigured: boolean;
  webhookConfigured: boolean;
  apiVersion: string;
  templateLanguage: string;
  missing: string[];
  templates: Record<string, string | null>;
  webhookPath: string;
  counts: { queued: number; failed: number; sent: number; delivered: number };
}

interface NotificationRow {
  id: string;
  orderNo?: string;
  type: string;
  templateName: string;
  recipient: string;
  status: string;
  attempts: number;
  lastError?: string;
  providerMessageId?: string;
  providerStatus?: string;
  createdAt?: string;
  nextAttemptAt?: string;
}

type NotificationList = { items: NotificationRow[]; total: number; page: number; pages: number };

const STATUSES = ["", "queued", "sending", "sent", "delivered", "read", "failed", "skipped"];

function statusTone(status: string): "green" | "red" | "amber" | "blue" | "muted" {
  if (status === "delivered" || status === "read") return "green";
  if (status === "failed") return "red";
  if (status === "queued" || status === "sending") return "amber";
  if (status === "sent") return "blue";
  return "muted";
}

function configTone(ok: boolean): "green" | "red" {
  return ok ? "green" : "red";
}

export default function WhatsAppPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [page, setPage] = useState(1);
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  const diagnostics = useQuery({
    queryKey: ["admin", "whatsapp", "diagnostics"],
    queryFn: async () => (await api<Diagnostics>("/api/v1/admin/whatsapp")).data,
  });
  const list = useQuery({
    queryKey: ["admin", "whatsapp", "notifications", status, orderNo, page],
    queryFn: async () => {
      const qs = new URLSearchParams({ page: String(page), limit: "25" });
      if (status) qs.set("status", status);
      if (orderNo.trim()) qs.set("orderNo", orderNo.trim());
      return (await api<NotificationList>(`/api/v1/admin/whatsapp/notifications?${qs}`)).data;
    },
  });

  const test = useMutation({
    mutationFn: async () =>
      (await api<{ status: string; providerMessageId?: string; error?: string }>("/api/v1/admin/whatsapp", {
        method: "POST",
        json: { to, text: text || undefined },
      })).data,
    onSuccess: (result) => {
      setTestResult(result.status === "sent" ? `Sent (${result.providerMessageId ?? "accepted"})` : `${result.status}: ${result.error ?? ""}`);
      qc.invalidateQueries({ queryKey: ["admin", "whatsapp"] });
    },
    onError: (error) => setTestResult(error instanceof ApiError ? error.message : "Test message failed"),
  });

  const retry = useMutation({
    mutationFn: async (id: string) =>
      (await api<{ status: string; error?: string }>(`/api/v1/admin/whatsapp/notifications/${id}/retry`, { method: "POST" })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "whatsapp"] }),
  });

  const d = diagnostics.data;
  const templates: { key: string; label: string }[] = [
    { key: "authentication_otp", label: "OTP authentication" },
    { key: "order_confirmation", label: "Order confirmation" },
    { key: "order_shipped", label: "Order shipped" },
    { key: "order_delivered", label: "Order delivered" },
    { key: "test", label: "Admin test (optional)" },
  ];

  return (
    <div>
      <PageHeader title="WhatsApp" subtitle="Meta Cloud API configuration, delivery history and safe test messages." />

      {d && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-sm border border-line bg-ivory/60 p-4">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted">Integration</p>
            <div className="mt-2"><Badge tone={configTone(d.enabled && d.sendConfigured)}>{d.enabled ? (d.sendConfigured ? "Enabled" : "Needs credentials") : "Disabled"}</Badge></div>
          </div>
          <div className="rounded-sm border border-line bg-ivory/60 p-4">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted">Webhook</p>
            <div className="mt-2"><Badge tone={configTone(d.webhookConfigured)}>{d.webhookConfigured ? "Configured" : "Incomplete"}</Badge></div>
            <p className="mt-2 break-all text-xs text-muted">{d.webhookPath}</p>
          </div>
          <div className="rounded-sm border border-line bg-ivory/60 p-4">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted">API version</p>
            <p className="mt-1 font-heading text-2xl text-olive">{d.apiVersion}</p>
            <p className="text-xs text-muted">Template language: {d.templateLanguage}</p>
          </div>
          <div className="rounded-sm border border-line bg-ivory/60 p-4">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted">Queue</p>
            <p className="mt-1 text-sm text-ink">{d.counts.queued} queued · {d.counts.failed} failed</p>
            <p className="text-xs text-muted">{d.counts.sent} accepted · {d.counts.delivered} delivered</p>
          </div>
        </div>
      )}

      {d && d.missing.length > 0 && (
        <div className="mb-6 rounded-sm border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <b>Missing server configuration:</b>{" "}
          <span className="font-mono text-xs">{d.missing.join(", ")}</span>
          <p className="mt-1 text-xs">Add these to the server-side environment and restart the application. The storefront and checkout keep working while WhatsApp is disabled.</p>
        </div>
      )}

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-sm border border-line p-4">
          <h2 className="font-heading text-xl">Approved templates</h2>
          <p className="mt-1 text-xs text-muted">Names must match WhatsApp Manager exactly. Template bodies and parameter order are documented in <span className="font-mono">docs/whatsapp-integration.md</span>.</p>
          <div className="mt-3 divide-y divide-line text-sm">
            {templates.map((t) => (
              <div key={t.key} className="flex items-center justify-between gap-3 py-2">
                <span>{t.label}</span>
                <span className="flex items-center gap-2">
                  <span className="max-w-[220px] truncate font-mono text-xs text-muted">{d?.templates[t.key] ?? "not set"}</span>
                  <Badge tone={configTone(!!d?.templates[t.key])}>{d?.templates[t.key] ? "Set" : "Missing"}</Badge>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-sm border border-line p-4">
          <h2 className="font-heading text-xl">Send a test message</h2>
          <p className="mt-1 text-xs text-muted">Sends only through the optional test template. No customer is messaged. The recipient must be a WhatsApp-capable number with country code.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Recipient number"><Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="9198xxxxxxxx" /></Field>
            <Field label="Test text (template {{1}})"><Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Woven Essence test message" /></Field>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={() => test.mutate()} disabled={!d?.enabled || !d?.templates.test || !d?.sendConfigured || !to.trim() || test.isPending}>
              {test.isPending ? "Sending…" : "Send test"}
            </Button>
            {testResult && <p className="text-xs text-muted">{testResult}</p>}
          </div>
          {!d?.templates.test && <p className="mt-2 text-xs text-amber-700">Set WHATSAPP_TEST_TEMPLATE and an approved single-variable Utility template to enable safe tests.</p>}
        </section>
      </div>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-heading text-2xl">Notification history</h2>
            <p className="text-xs text-muted">Delivery status is separate from order and payment status.</p>
          </div>
          <div className="flex items-end gap-2">
            <Field label="Order number"><Input className="w-40" value={orderNo} onChange={(e) => { setOrderNo(e.target.value); setPage(1); }} placeholder="WE-…" /></Field>
            <Field label="Status">
              <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
                {STATUSES.map((s) => <option key={s} value={s}>{s || "All"}</option>)}
              </Select>
            </Field>
          </div>
        </div>
        <Table
          rows={list.data?.items ?? []}
          loading={list.isLoading}
          empty="No WhatsApp notifications yet."
          columns={[
            { key: "createdAt", label: "Created", render: (r) => <span className="whitespace-nowrap text-xs">{r.createdAt ? new Date(r.createdAt).toLocaleString("en-IN") : "—"}</span> },
            { key: "orderNo", label: "Order", render: (r) => <span className="font-mono text-xs">{r.orderNo ?? "test"}</span> },
            { key: "type", label: "Type", render: (r) => <span className="text-xs">{r.type}</span> },
            { key: "recipient", label: "To", render: (r) => <span className="font-mono text-xs">{r.recipient}</span> },
            { key: "status", label: "Status", render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
            { key: "attempts", label: "Tries" },
            { key: "providerMessageId", label: "Provider ID", render: (r) => <span className="block max-w-[130px] truncate font-mono text-[10px] text-muted">{r.providerMessageId ?? "—"}</span> },
            { key: "lastError", label: "Last error", render: (r) => <span className="block max-w-[240px] text-xs text-red-700">{r.lastError ?? ""}</span> },
            {
              key: "action",
              label: "",
              render: (r) => (r.status === "failed" || r.status === "queued" || r.status === "skipped") ? (
                <Button variant="outline" className="h-7 px-2 text-[10px]" onClick={() => retry.mutate(r.id)} disabled={retry.isPending}>Retry</Button>
              ) : null,
            },
          ]}
        />
        {list.data && <Pager page={list.data.page} pages={list.data.pages} onChange={setPage} />}
        {list.error && <p className="mt-2 text-sm text-red-700">{list.error instanceof ApiError ? list.error.message : "Could not load notification history"}</p>}
      </section>

      <p className="mt-8 text-xs text-muted">
        Production readiness still requires Meta credentials, approved templates, a public HTTPS webhook and real end-to-end delivery tests. WhatsApp delivery failures never cancel or invalidate an order.
      </p>
    </div>
  );
}

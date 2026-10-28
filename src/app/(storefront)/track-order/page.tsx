import type { Metadata } from "next";
import { TrackOrderForm } from "@/components/account/track-order-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { verifyOrderTrackingToken } from "@/lib/whatsapp/tracking";

export const metadata: Metadata = { title: "Track your order", robots: { index: false } };

export default async function TrackOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ orderNo?: string; phone?: string; token?: string }>;
}) {
  const { orderNo, phone, token } = await searchParams;
  const tokenOrderNo = token ? await verifyOrderTrackingToken(token) : null;
  const invalidToken = !!token && !tokenOrderNo;
  return (
    <div className="mx-auto max-w-site px-4 py-6 sm:px-6">
      <Breadcrumbs items={[{ label: "Track order" }]} />
      <div className="mx-auto mt-8 max-w-2xl">
        <p className="text-[11px] uppercase tracking-[0.2em] text-gold">Order updates</p>
        <h1 className="mt-2 text-4xl">Track your order</h1>
        <p className="mt-3 max-w-lg text-sm text-muted">
          {tokenOrderNo
            ? "This secure link shows the live status of your order."
            : "Enter your order number and the phone number used at checkout to view the latest status."}
        </p>
        {invalidToken && <p className="mt-3 text-sm text-amber-800">This tracking link is invalid or has expired. Use your order number and phone below.</p>}
        <div className="mt-7">
          <TrackOrderForm initialOrderNo={tokenOrderNo ?? orderNo ?? ""} initialPhone={phone ?? ""} initialToken={tokenOrderNo ? token : undefined} />
        </div>
      </div>
    </div>
  );
}

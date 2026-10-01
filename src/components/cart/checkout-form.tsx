"use client";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Address } from "@/domain/types";
import { api, ApiError } from "@/hooks/api";
import { useCart } from "@/hooks/useCart";
import { formatMoney } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { useUi } from "@/store/ui";

const STATES = ["Andhra Pradesh", "Assam", "Bihar", "Chhattisgarh", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Odisha", "Punjab", "Rajasthan", "Tamil Nadu", "Telangana", "Uttar Pradesh", "Uttarakhand", "West Bengal"];

interface Props {
  customer: { name: string; mobile: string; email?: string; addresses: Address[] } | null;
  codEnabled: boolean;
  razorpayEnabled: boolean;
}

export function CheckoutForm({ customer, codEnabled, razorpayEnabled }: Props) {
  const { cart, refresh } = useCart();
  const currency = useUi((s) => s.currency);
  const router = useRouter();
  const def = customer?.addresses.find((a) => a.isDefault) ?? customer?.addresses[0];
  const [addr, setAddr] = useState<Address>(def ?? { name: customer?.name ?? "", phone: customer?.mobile ?? "", line1: "", line2: "", city: "", state: "Karnataka", pincode: "", country: "India" });
  const [email, setEmail] = useState(customer?.email ?? "");
  const [mode, setMode] = useState<"COD" | "RAZORPAY">(razorpayEnabled ? "RAZORPAY" : "COD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setAddr({ ...addr, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { address: addr, paymentMode: mode, email: email || undefined };
      const first = (await api<{ step: string; orderNo?: string; gateway?: { gatewayOrderId: string; stub: boolean; amount: number; keyId: string } }>("/api/v1/checkout", { method: "POST", json: body })).data;
      if (first.step === "done") return finish(first.orderNo!);
      // Razorpay: open widget (stub auto-confirms in dev).
      const gw = first.gateway!;
      const payment = gw.stub
        ? { orderId: gw.gatewayOrderId, paymentId: `pay_stub_${Date.now()}`, signature: "stub_signature" }
        : await openRazorpay(gw, addr, email);
      const second = (await api<{ step: string; orderNo: string }>("/api/v1/checkout", { method: "POST", json: { ...body, payment } })).data;
      finish(second.orderNo);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }
  function finish(orderNo: string) {
    refresh();
    router.push(`/checkout/success/${orderNo}`);
  }

  if (!cart) return <p className="mt-8 text-sm text-muted">Loading…</p>;
  if (!cart.lines.length) return <p className="mt-8 text-sm text-muted">Your bag is empty. <Link href="/collections/sarees" className="text-maroon underline">Shop sarees</Link></p>;
  const t = cart.totals;

  return (
    <form onSubmit={submit} className="mt-8 grid gap-10 lg:grid-cols-[1fr_400px]">
      <div className="space-y-8">
        {!customer && (
          <p className="rounded-sm border border-line bg-white/60 p-3 text-xs text-muted">
            Checking out as guest. <Link href="/login?next=/checkout" className="text-maroon underline">Log in</Link> or <Link href="/register?next=/checkout" className="text-maroon underline">create an account</Link> to use saved addresses and track orders.
          </p>
        )}
        {customer && customer.addresses.length > 0 && (
          <section>
            <h2 className="mb-3 text-2xl">Saved addresses</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {customer.addresses.map((a, i) => (
                <button type="button" key={i} onClick={() => setAddr(a)} className={`rounded-sm border p-3 text-left text-xs ${a.line1 === addr.line1 && a.pincode === addr.pincode ? "border-gold bg-gold/5" : "border-line"}`}>
                  <p className="font-medium">{a.name}</p>
                  <p className="text-muted">{a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.city} {a.pincode}</p>
                </button>
              ))}
            </div>
          </section>
        )}
        <section>
          <h2 className="mb-4 text-2xl">Delivery address</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name"><Input required value={addr.name ?? ""} onChange={set("name")} /></Field>
            <Field label="Mobile"><Input required inputMode="numeric" pattern="[6-9][0-9]{9}" value={addr.phone ?? ""} onChange={set("phone")} /></Field>
            <div className="sm:col-span-2"><Field label="Email (for order updates)"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field></div>
            <div className="sm:col-span-2"><Field label="Address line 1"><Input required value={addr.line1} onChange={set("line1")} /></Field></div>
            <div className="sm:col-span-2"><Field label="Address line 2"><Input value={addr.line2 ?? ""} onChange={set("line2")} /></Field></div>
            <Field label="City"><Input required value={addr.city} onChange={set("city")} /></Field>
            <Field label="State"><Select value={addr.state} onChange={set("state")}>{STATES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
            <Field label="Pincode"><Input required inputMode="numeric" pattern="[1-9][0-9]{5}" value={addr.pincode} onChange={set("pincode")} /></Field>
          </div>
        </section>
        <section>
          <h2 className="mb-4 text-2xl">Payment</h2>
          <div className="grid gap-2">
            {razorpayEnabled && <PayOption on={mode === "RAZORPAY"} onClick={() => setMode("RAZORPAY")} title="UPI / Cards / Netbanking" text="Secure payment via Razorpay" />}
            {codEnabled && <PayOption on={mode === "COD"} onClick={() => setMode("COD")} title="Cash on delivery" text="Pay when your saree arrives" />}
          </div>
        </section>
      </div>

      <aside className="h-fit rounded-sm border border-line bg-white/60 p-6">
        <h2 className="text-2xl">Your order</h2>
        <ul className="mt-4 divide-y divide-line">
          {cart.lines.map((l) => (
            <li key={l.sku} className="flex items-center gap-3 py-3 text-sm">
              <span className="relative h-16 w-12 shrink-0 overflow-hidden rounded-sm bg-line">{l.product.images[0] && <Image src={l.product.images[0]} alt="" fill sizes="48px" className="object-cover" />}</span>
              <span className="min-w-0 flex-1"><span className="line-clamp-2">{l.product.name}</span><span className="text-xs text-muted">× {l.qty}</span></span>
              <span>{formatMoney(l.product.pricing.sellingPrice * l.qty, currency)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatMoney(t.subTotal, currency)}</dd></div>
          {t.couponDiscount > 0 && <div className="flex justify-between text-olive"><dt>Coupon {cart.couponCode}</dt><dd>− {formatMoney(t.couponDiscount, currency)}</dd></div>}
          <div className="flex justify-between"><dt>Shipping</dt><dd>{t.shippingCharge ? formatMoney(t.shippingCharge, currency) : "Free"}</dd></div>
          <div className="flex justify-between border-t border-line pt-3 text-base font-medium"><dt>Total</dt><dd>{formatMoney(t.netAmount, currency)}</dd></div>
        </dl>
        {error && <p className="mt-4 rounded-sm bg-red-50 p-2 text-xs text-red-800">{error}</p>}
        <Button type="submit" size="lg" className="mt-6 w-full" loading={busy}>{mode === "COD" ? "Place order" : `Pay ${formatMoney(t.netAmount, "INR")}`}</Button>
        <p className="mt-3 text-center text-[11px] text-muted">Orders are billed in INR. By placing an order you agree to our policies.</p>
      </aside>
    </form>
  );
}

function PayOption({ on, onClick, title, text }: { on: boolean; onClick: () => void; title: string; text: string }) {
  return (
    <button type="button" onClick={onClick} className={`flex items-center gap-3 rounded-sm border p-4 text-left ${on ? "border-gold bg-gold/5" : "border-line"}`}>
      <span className={`h-4 w-4 rounded-full border ${on ? "border-4 border-olive" : "border-line"}`} />
      <span><span className="block text-sm font-medium">{title}</span><span className="text-xs text-muted">{text}</span></span>
    </button>
  );
}

declare global { interface Window { Razorpay?: new (o: unknown) => { open: () => void } } }

/** Loads checkout.js and resolves with the payment triple. */
function openRazorpay(gw: { gatewayOrderId: string; amount: number; keyId: string }, addr: Address, email: string) {
  return new Promise<{ orderId: string; paymentId: string; signature: string }>((resolve, reject) => {
    const run = () => {
      if (!window.Razorpay) return reject(new Error("Razorpay failed to load"));
      const rzp = new window.Razorpay({
        key: gw.keyId,
        amount: gw.amount,
        currency: "INR",
        order_id: gw.gatewayOrderId,
        name: "Woven Essence",
        prefill: { name: addr.name, contact: addr.phone, email },
        theme: { color: "#7A1F2B" },
        handler: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => resolve({ orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }),
        modal: { ondismiss: () => reject(new Error("Payment cancelled")) },
      });
      rzp.open();
    };
    if (window.Razorpay) return run();
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = run;
    s.onerror = () => reject(new Error("Razorpay failed to load"));
    document.body.appendChild(s);
  });
}

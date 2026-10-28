"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/hooks/api";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export function OtpLogin({ next }: { next: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [step, setStep] = useState<"mobile" | "code">("mobile");
  const [expiresInSec, setExpiresInSec] = useState(60);
  const [resendIn, setResendIn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setInterval(() => setResendIn((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  async function send(resend = false) {
    setBusy(true); setError(null);
    try {
      const r = (await api<{ expiresInSec?: number }>("/api/v1/auth/otp/send", {
        method: "POST",
        json: { mobile },
      })).data;
      setExpiresInSec(r.expiresInSec ?? 60);
      setResendIn(60);
      setCode("");
      setStep("code");
      if (resend) setError("A new code was sent.");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not send OTP"); }
    finally { setBusy(false); }
  }

  async function verify() {
    setBusy(true); setError(null);
    try {
      await api("/api/v1/auth/otp/verify", { method: "POST", json: { mobile, code, name: name.trim() || undefined } });
      qc.invalidateQueries();
      router.push(next);
      router.refresh();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not verify"); setBusy(false); }
  }

  const minutes = Math.max(1, Math.round(expiresInSec / 60));

  return (
    <form className="mt-8 space-y-4" onSubmit={(e) => { e.preventDefault(); step === "mobile" ? send() : verify(); }}>
      <Field label="Mobile number">
        <div className="flex">
          <span className="flex h-10 items-center rounded-l-sm border border-r-0 border-line bg-line/40 px-3 text-sm text-muted">+91</span>
          <Input required inputMode="numeric" pattern="[6-9][0-9]{9}" maxLength={10} autoComplete="tel-national" value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))} disabled={step === "code"} className="rounded-l-none" />
        </div>
      </Field>

      {step === "code" && (
        <>
          <Field
            label="6-digit code"
            hint={`Sent on WhatsApp · valid for ${minutes} ${minutes === 1 ? "minute" : "minutes"}`}
          >
            <Input required autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="tracking-[0.5em]" />
          </Field>
          <Field label="Your name (first time only)"><Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        </>
      )}

      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        {step === "mobile" ? "Send code on WhatsApp" : "Verify & continue"}
      </Button>

      {step === "code" && (
        <div className="flex items-center justify-between text-xs">
          <button type="button" onClick={() => { setStep("mobile"); setCode(""); setError(null); }} className="uppercase tracking-widest text-muted hover:text-olive">Change number</button>
          <button type="button" disabled={resendIn > 0 || busy} onClick={() => send(true)} className="uppercase tracking-widest text-muted hover:text-olive disabled:opacity-50">
            {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
          </button>
        </div>
      )}
    </form>
  );
}

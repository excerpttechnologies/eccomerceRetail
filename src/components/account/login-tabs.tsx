"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { LoginForm } from "./customer-auth-forms";
import { OtpLogin } from "./otp-login";

export function LoginTabs({ next, whatsappAvailable }: { next: string; whatsappAvailable: boolean }) {
  const [mode, setMode] = useState<"email" | "otp">("email");

  // The legacy SMS provider was a stub: it reported success without delivering a code.
  // Until a real SMS provider is wired up, only offer the OTP tab when WhatsApp works.
  if (!whatsappAvailable) return <LoginForm next={next} />;

  return (
    <div className="mt-7">
      <div className="grid grid-cols-2 border-b border-line">
        {([
          { key: "email", label: "Email & password" },
          { key: "otp", label: "WhatsApp OTP" },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setMode(tab.key)}
            aria-pressed={mode === tab.key}
            className={cn(
              "-mb-px border-b-2 px-2 pb-3 text-xs uppercase tracking-[0.14em] transition-colors",
              mode === tab.key ? "border-gold text-olive" : "border-transparent text-muted hover:text-olive",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {mode === "email" ? <LoginForm next={next} /> : <OtpLogin next={next} />}
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import type { Address } from "@/domain/types";
import { api } from "@/hooks/api";
import { useCityLookup } from "@/hooks/use-city-lookup";
import { usePincodeLookup } from "@/hooks/use-pincode-lookup";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

const blank: Address = { name: "", phone: "", line1: "", line2: "", city: "", state: "", pincode: "", country: "India" };

export function AddressBook({ initial }: { initial: Address[] }) {
  const [list, setList] = useState(initial);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Address>(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [citySuggestionsOpen, setCitySuggestionsOpen] = useState(false);
  const cityLookup = useCityLookup(draft.city);
  const pincodeLookup = usePincodeLookup(draft.pincode);

  useEffect(() => {
    if (pincodeLookup.location) {
      setDraft((current) => current.pincode === pincodeLookup.location?.pin
        ? { ...current, city: pincodeLookup.location.city, state: pincodeLookup.location.state }
        : current);
    }
  }, [pincodeLookup.location]);

  useEffect(() => {
    const cityMatch = cityLookup.locations.filter((location) => location.city.toLocaleLowerCase() === draft.city.trim().toLocaleLowerCase());
    const states = new Set(cityMatch.map((location) => location.state));
    if (cityMatch.length && states.size === 1) {
      setCitySuggestionsOpen(false);
      setDraft((current) => current.city.trim().toLocaleLowerCase() === draft.city.trim().toLocaleLowerCase()
        ? { ...current, city: cityMatch[0].city, state: cityMatch[0].state }
        : current);
    }
  }, [cityLookup.locations, draft.city]);

  async function save(next: Address[]) {
    setBusy(true); setError(null);
    try {
      const r = (await api<{ addresses: Address[] }>("/api/v1/account/addresses", { method: "PUT", json: { addresses: next } })).data;
      setList(r.addresses); setEditing(null); setDraft(blank);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const f = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = k === "pincode" || k === "phone" ? e.target.value.replace(/\D/g, "").slice(0, k === "phone" ? 10 : 6) : e.target.value;
    setDraft({ ...draft, [k]: value, ...(k === "pincode" ? { city: "", state: "" } : k === "city" ? { state: "" } : {}) });
  };

  return (
    <div className="space-y-6">
      <ul className="grid gap-3 sm:grid-cols-2">
        {list.map((a, i) => (
          <li key={i} className="rounded-sm border border-line bg-white/60 p-4 text-sm">
            <p className="font-medium">{a.name} {a.isDefault && <span className="ml-2 text-[10px] uppercase tracking-widest text-gold">Default</span>}</p>
            <p className="text-muted">{a.line1}{a.line2 ? `, ${a.line2}` : ""}<br />{a.city}, {a.state} {a.pincode}<br />{a.phone}</p>
            <div className="mt-3 flex gap-3 text-xs uppercase tracking-widest">
              <button onClick={() => { setEditing(i); setDraft(a); }} className="text-olive">Edit</button>
              {!a.isDefault && <button onClick={() => save(list.map((x, j) => ({ ...x, isDefault: j === i })))} className="text-olive">Make default</button>}
              <button onClick={() => save(list.filter((_, j) => j !== i))} className="text-red-700">Delete</button>
            </div>
          </li>
        ))}
        {list.length === 0 && <li className="text-sm text-muted">No saved addresses.</li>}
      </ul>
      <form className="grid gap-3 rounded-sm border border-line bg-white/60 p-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save(editing === null ? [...list, draft] : list.map((a, i) => (i === editing ? draft : a))); }}>
        <h3 className="text-2xl sm:col-span-2">{editing === null ? "Add address" : "Edit address"}</h3>
        <Field label="Name"><Input required value={draft.name ?? ""} onChange={f("name")} /></Field>
        <Field label="Mobile"><Input required type="tel" inputMode="numeric" pattern="[6-9][0-9]{9}" maxLength={10} value={draft.phone ?? ""} onChange={f("phone")} /></Field>
        <div className="sm:col-span-2"><Field label="Line 1"><Input required value={draft.line1} onChange={f("line1")} /></Field></div>
        <div className="sm:col-span-2"><Field label="Line 2"><Input value={draft.line2 ?? ""} onChange={f("line2")} /></Field></div>
        <div className="relative">
          <Field label="City"><Input required value={draft.city} onChange={(e) => { setCitySuggestionsOpen(true); f("city")(e); }} /></Field>
          {citySuggestionsOpen && cityLookup.locations.length > 0 && <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-sm border border-line bg-white py-1 shadow-lg" aria-label="City suggestions">{cityLookup.locations.map((location) => <button type="button" key={`${location.city}-${location.state}`} onClick={() => { setDraft((current) => ({ ...current, city: location.city, state: location.state })); setCitySuggestionsOpen(false); }} className="block w-full px-3 py-2 text-left text-xs text-olive hover:bg-olive/5">{location.city}, {location.state}</button>)}</div>}
        </div>
        <Field label="State"><Input required value={draft.state} onChange={f("state")} /></Field>
        <Field label="Pincode"><Input required inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} title="Enter a valid 6-digit Indian PIN code" value={draft.pincode} onChange={f("pincode")} /></Field>
        <div className="flex items-end gap-3"><Button type="submit" variant="secondary" loading={busy}>{editing === null ? "Add" : "Save"}</Button>{editing !== null && <Button type="button" variant="ghost" onClick={() => { setEditing(null); setDraft(blank); }}>Cancel</Button>}</div>
        {pincodeLookup.status === "checking" && <p aria-live="polite" className="text-xs text-muted sm:col-span-2">Finding city and state…</p>}
        {pincodeLookup.status === "invalid" && <p role="alert" className="text-xs text-red-700 sm:col-span-2">Pincode is incorrect. Please enter a valid Indian pincode.</p>}
        {pincodeLookup.status === "error" && <p role="alert" className="text-xs text-red-700 sm:col-span-2">Could not verify this pincode. Please try again.</p>}
        {cityLookup.loading && <p aria-live="polite" className="text-xs text-muted sm:col-span-2">Finding city and state…</p>}
        {cityLookup.error && <p role="alert" className="text-xs text-red-700 sm:col-span-2">Could not look up the city. Please try again or enter the state manually.</p>}
        {error && <p className="text-xs text-red-700 sm:col-span-2">{error}</p>}
      </form>
    </div>
  );
}

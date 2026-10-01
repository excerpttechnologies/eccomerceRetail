import type { Metadata } from "next";
import { getSettings } from "@/lib/site-data";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ContactForm } from "@/components/account/contact-form";

export const metadata: Metadata = { title: "Contact us" };

export default async function ContactPage() {
  const s = await getSettings();
  return (
    <div className="mx-auto max-w-site px-4 py-6 sm:px-6">
      <Breadcrumbs items={[{ label: "Contact" }]} />
      <div className="mt-4 grid gap-10 md:grid-cols-2">
        <div>
          <h1 className="we-rule text-4xl">Talk to us</h1>
          <div className="mt-6 space-y-2 text-sm text-ink/80">
            {s.contact?.address && <p>{s.contact.address}</p>}
            {s.contact?.phone && <p><a href={`tel:${s.contact.phone}`} className="hover:text-maroon">{s.contact.phone}</a></p>}
            {s.contact?.email && <p><a href={`mailto:${s.contact.email}`} className="hover:text-maroon">{s.contact.email}</a></p>}
            {s.contact?.hours && <p className="text-muted">{s.contact.hours}</p>}
            {s.whatsappNumber && <p><a href={`https://wa.me/${s.whatsappNumber}`} target="_blank" rel="noreferrer" className="text-olive underline underline-offset-4">Chat on WhatsApp</a></p>}
          </div>
        </div>
        <ContactForm />
      </div>
    </div>
  );
}

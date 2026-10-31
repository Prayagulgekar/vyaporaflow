import type { Metadata } from "next";
import Link from "next/link";
import { PageIntro, Section } from "@/components/marketing";

export const metadata: Metadata = { title: "Pricing" };

export default function Pricing() {
  return (
    <>
      <PageIntro eyebrow="Pricing" title="Plans coming soon.">
        Pricing has not been decided yet. While VyaporaFlow is in early use, contact us to discuss your business.
      </PageIntro>
      <Section>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="card p-6">
            <h2 className="font-semibold">Wholesalers and distributors</h2>
            <p className="mt-2 font-display text-3xl">Contact for pricing</p>
            <p className="mt-2 text-sm text-ink-muted">Tell us the size of your business and how many staff will use VyaporaFlow.</p>
            <Link href="/contact?topic=pricing" className="btn btn-primary mt-6">
              Contact us
            </Link>
          </div>
          <div className="card p-6">
            <h2 className="font-semibold">Retailers</h2>
            <p className="mt-2 font-display text-3xl">Plans coming soon</p>
            <p className="mt-2 text-sm text-ink-muted">Find wholesalers, place orders and track invoices and payments.</p>
            <Link href="/register?type=retailer" className="btn btn-secondary mt-6">
              Create a retailer account
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}

import type { Metadata } from "next";
import { LegalReview, PageIntro, Section } from "@/components/marketing";

export const metadata: Metadata = { title: "Terms of use" };

export default function Terms() {
  return (
    <>
      <PageIntro eyebrow="Draft" title="Terms of use">
        Draft terms for VyaporaFlow. This document has not been reviewed by a lawyer and is not yet in force.
      </PageIntro>
      <Section>
        <article className="prose-vf max-w-[var(--spacing-prose)] space-y-4 text-[15px] leading-7">
          <LegalReview>The whole document requires review by a qualified lawyer in India before launch, including the operator&apos;s legal name, registered address and governing law.</LegalReview>
          <h2 className="font-display text-2xl">1. The service</h2>
          <p>VyaporaFlow is software that helps wholesalers and distributors keep records of products, stock, orders, deliveries, invoices and payments, and helps retailers place orders with wholesalers they are connected to.</p>
          <p>VyaporaFlow is not a party to any sale between a wholesaler and a retailer. The wholesaler is the seller. Prices, product descriptions, tax rates, delivery and returns are the responsibility of the wholesaler.</p>
          <h2 className="font-display text-2xl">2. Accounts</h2>
          <p>You must give accurate business details and keep your password private. A business owner is responsible for the people they invite to their business account and the roles they give them.</p>
          <h2 className="font-display text-2xl">3. Payments</h2>
          <p>VyaporaFlow does not process payments. Payment records are entered by the wholesaler after money is received by cash, UPI, bank transfer or cheque. A payment record in VyaporaFlow is not proof that a bank or payment provider has settled the amount.</p>
          <LegalReview>Confirm wording on payment records and any future payment gateway terms.</LegalReview>
          <h2 className="font-display text-2xl">4. Tax and invoices</h2>
          <p>Invoices are generated from the information the wholesaler provides, including HSN codes and GST rates. VyaporaFlow does not file GST returns, generate e-invoices (IRN) or e-way bills, and does not give tax advice. The wholesaler is responsible for the correctness of its invoices.</p>
          <LegalReview>Check obligations relating to GST invoicing rules, e-invoicing thresholds and record retention.</LegalReview>
          <h2 className="font-display text-2xl">5. Acceptable use</h2>
          <p>You may not use VyaporaFlow to sell goods that are illegal to sell, to misrepresent your business, to access another business&apos;s data, or to interfere with the service. Businesses listing regulated goods (for example LPG cylinders) must hold the licences their activity requires.</p>
          <h2 className="font-display text-2xl">6. Suspension</h2>
          <p>Platform administrators may suspend a business that breaks these terms. A suspended business can view its records but cannot place, accept or change orders or financial records.</p>
          <h2 className="font-display text-2xl">7. Liability</h2>
          <LegalReview>Limitation of liability, indemnity, warranty disclaimers and dispute resolution clauses must be drafted by a lawyer.</LegalReview>
          <h2 className="font-display text-2xl">8. Changes</h2>
          <p>We will tell account owners about material changes to these terms before they take effect.</p>
        </article>
      </Section>
    </>
  );
}

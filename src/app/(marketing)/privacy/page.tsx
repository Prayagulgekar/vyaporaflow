import type { Metadata } from "next";
import { LegalReview, PageIntro, Section } from "@/components/marketing";

export const metadata: Metadata = { title: "Privacy policy" };

export default function Privacy() {
  return (
    <>
      <PageIntro eyebrow="Draft" title="Privacy policy">
        How VyaporaFlow handles personal and business information. This draft has not been reviewed by a lawyer.
      </PageIntro>
      <Section>
        <article className="max-w-[var(--spacing-prose)] space-y-4 text-[15px] leading-7">
          <LegalReview>Review against the Digital Personal Data Protection Act, 2023 and its rules, including notice, consent, grievance officer details and data retention periods.</LegalReview>
          <h2 className="font-display text-2xl">What we collect</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Account details: name, email address, mobile number and password (stored only as a one-way hash).</li>
            <li>Business details: business name, GSTIN, address, PIN code and, if you enter them, map coordinates of the business.</li>
            <li>Records you create: products, prices, orders, deliveries, invoices and payment records.</li>
            <li>Location for marketplace search: if you choose &ldquo;Use my location&rdquo;, your browser shares your approximate position for that search. It is used to calculate distances and is not stored with your account.</li>
          </ul>
          <h2 className="font-display text-2xl">Who can see it</h2>
          <p>A wholesaler&apos;s records are visible to that wholesaler&apos;s team according to their roles. A retailer sees its own orders, invoices and payments, and the catalogue and prices of wholesalers that approved it. Delivery staff see the address, contact number and items of deliveries assigned to them. Platform administrators can see account and business details to provide support and handle verification.</p>
          <p>Business listings in the marketplace show the business name, area, category, distance and delivery coverage. Exact prices are shown only to approved retailers.</p>
          <h2 className="font-display text-2xl">Messages</h2>
          <p>VyaporaFlow does not send SMS or WhatsApp messages on your behalf. WhatsApp links open the WhatsApp app with a prepared message that you choose whether to send.</p>
          <h2 className="font-display text-2xl">Storage and security</h2>
          <p>Data is stored in a PostgreSQL database with row-level access rules. Uploaded product images and logos are stored in file storage.</p>
          <LegalReview>State the hosting region, sub-processors (for example the database and hosting providers), retention periods and breach notification process.</LegalReview>
          <h2 className="font-display text-2xl">Your choices</h2>
          <p>You can update your profile at any time. To delete your account or business, contact us. Financial records may need to be kept for the period required by tax law.</p>
          <LegalReview>Confirm the retention period for invoices and payment records and the procedure for data principal requests.</LegalReview>
          <h2 className="font-display text-2xl">Contact</h2>
          <p>Write to us using the contact page.</p>
          <LegalReview>Add the grievance officer&apos;s name and contact details required by law.</LegalReview>
        </article>
      </Section>
    </>
  );
}

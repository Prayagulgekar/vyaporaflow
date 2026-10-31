import type { Metadata } from "next";
import { CtaBand, PageIntro, Screenshot, Section } from "@/components/marketing";

export const metadata: Metadata = { title: "How it works" };

const STEPS = [
  { title: "Create your business", body: "Register, then add your business name, GSTIN if you have one, address and PIN code. Your location is used for marketplace distance only." },
  { title: "Add products and stock", body: "Add products by hand or import a CSV. Set selling units and prices, then record opening stock." },
  { title: "Set delivery coverage", body: "Choose a delivery radius or a list of PIN codes, a minimum order value and delivery charge. Or offer pickup only." },
  { title: "Retailers connect", body: "Retailers find you in the marketplace and ask to connect. You approve them (or approve automatically) and set a credit limit if you want." },
  { title: "Orders come in", body: "Approved retailers order from your catalogue. Stock is reserved straight away. You accept, prepare and mark the order ready." },
  { title: "Deliver and invoice", body: "Assign the order to a delivery person. When it is delivered, generate the GST invoice. Partial deliveries are handled." },
  { title: "Record payments", body: "Record payments as they come in. VyaporaFlow applies them to the oldest unpaid invoices unless you choose otherwise, and keeps each balance up to date." },
];

export default function HowItWorks() {
  return (
    <>
      <PageIntro eyebrow="How it works" title="From first product to paid invoice.">
        A typical first week for a distributor, step by step.
      </PageIntro>
      <Section>
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr]">
          <ol className="space-y-6">
            {STEPS.map((s, i) => (
              <li key={s.title} className="grid grid-cols-[2.5rem_1fr] gap-3">
                <span className="flex size-9 items-center justify-center rounded-full border border-line-strong bg-surface font-display text-lg" aria-hidden>
                  {i + 1}
                </span>
                <div>
                  <h2 className="font-semibold">{s.title}</h2>
                  <p className="mt-1 text-sm text-ink-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="space-y-8">
            <Screenshot src="/screenshots/wholesaler-orders.png" alt="Order list with status filters" width={1280} height={860} caption="Orders, from the demo workspace" />
            <Screenshot mobile src="/screenshots/delivery-mobile.png" alt="Delivery person's list of assigned stops on a phone" width={390} height={844} caption="Delivery staff view" />
          </div>
        </div>
      </Section>
      <CtaBand />
    </>
  );
}

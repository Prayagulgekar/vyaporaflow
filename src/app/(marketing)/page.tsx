import Link from "next/link";
import { CtaBand, FeatureList, Screenshot, Section, SectionHeading } from "@/components/marketing";

export default function Home() {
  return (
    <>
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-[var(--spacing-content)] items-center gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1fr_1.15fr]">
          <div>
            <h1 className="font-display text-[2.6rem] leading-[1.08] text-ink sm:text-6xl">Your wholesale business. Under control.</h1>
            <p className="mt-5 max-w-xl text-lg text-ink-muted">
              Manage products, retailer orders, deliveries, and outstanding payments from one simple workspace. Give your retailers an easier way to order the products they need.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register?type=wholesaler" className="btn btn-primary px-5 py-3 text-base">
                Start with your business
              </Link>
              <Link href="/marketplace" className="btn btn-secondary px-5 py-3 text-base">
                Explore the marketplace
              </Link>
            </div>
            <p className="mt-4 text-sm text-ink-muted">
              Running a shop? <Link href="/for-retailers" className="link">See how retailers order</Link>.
            </p>
          </div>
          <Screenshot src="/screenshots/wholesaler-overview.png" alt="Wholesaler overview showing orders to act on, today's sales, outstanding payments and low stock" width={1280} height={860} caption="Wholesaler overview, from the demo workspace" />
        </div>
      </section>

      <Section>
        <SectionHeading eyebrow="One workspace" title="The day's work, in the order it happens.">
          Orders arrive, stock is reserved, goods go out, invoices are raised and payments come in. Each step updates the next, so the numbers agree.
        </SectionHeading>
        <div className="mt-10">
          <FeatureList
            items={[
              { title: "Orders you can act on", body: "New orders appear with the retailer, total and items. Accept, prepare, mark ready and dispatch in a few taps. Every change is recorded with who made it and when." },
              { title: "Stock that stays correct", body: "Placing an order reserves stock. Dispatch deducts it. Cancellations and returns put it back. Low stock and expiring batches are flagged." },
              { title: "Outstanding payments, per retailer", body: "Record cash, UPI, bank transfer or cheque payments, including part payments and advances. See who owes what, and since when." },
              { title: "GST invoices from the order", body: "Generate an invoice from a delivered order with HSN codes and CGST/SGST or IGST worked out from the two addresses." },
              { title: "Deliveries without phone calls", body: "Assign an order to a delivery person. They see their stops on a phone, mark delivered, partly delivered or failed, and note cash collected." },
              { title: "Retailers order directly", body: "Approved retailers see your prices, add items to a cart for your business only, and track their orders and invoices." },
            ]}
          />
        </div>
      </Section>

      <Section tone="sunken">
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_auto]">
          <div>
            <SectionHeading eyebrow="For retailers" title="Order from your wholesalers on your phone.">
              Find wholesalers within 10 to 60 km of your shop, ask to connect, then order in the unit they sell: packets, boxes, cartons, kilograms or cylinders. Each wholesaler gets its own cart, so orders never mix.
            </SectionHeading>
            <ul className="mt-6 space-y-2 text-sm text-ink-muted">
              <li>Reorder a previous order in one tap, with current prices and stock checked again.</li>
              <li>See invoices, payments and the balance you owe each wholesaler.</li>
              <li>Message the wholesaler on WhatsApp from the order page.</li>
            </ul>
            <Link href="/for-retailers" className="btn btn-secondary mt-6">
              How ordering works
            </Link>
          </div>
          <div className="flex gap-4">
            <Screenshot mobile src="/screenshots/retailer-catalog-mobile.png" alt="Retailer viewing a wholesaler's catalogue on a phone" width={390} height={844} />
            <div className="hidden sm:block">
              <Screenshot mobile src="/screenshots/retailer-cart-mobile.png" alt="Retailer cart for one wholesaler with totals and GST" width={390} height={844} />
            </div>
          </div>
        </div>
      </Section>

      <Section>
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <Screenshot src="/screenshots/marketplace.png" alt="Marketplace search results for wholesalers near a PIN code" width={1280} height={860} caption="Marketplace search, from the demo workspace" />
          <div>
            <SectionHeading eyebrow="Marketplace" title="Be found by shops near you.">
              Retailers search by GPS, city or PIN code. Results show distance and whether you deliver to them, deliver after confirmation, or offer pickup only. Delivery coverage is set by you, separately from how far retailers search.
            </SectionHeading>
            <Link href="/marketplace" className="btn btn-secondary mt-6">
              Explore the marketplace
            </Link>
          </div>
        </div>
      </Section>

      <Section tone="sunken">
        <SectionHeading eyebrow="Honest about the details" title="What VyaporaFlow does not do yet">
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>There is no online payment gateway. Payments are recorded by the wholesaler after they are received.</li>
            <li>It does not file GST returns or generate e-invoices or e-way bills. Invoices should be checked by your accountant.</li>
            <li>WhatsApp links open a chat in WhatsApp; messages are not sent automatically.</li>
          </ul>
        </SectionHeading>
      </Section>

      <CtaBand />
    </>
  );
}

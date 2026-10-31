import type { Metadata } from "next";
import Link from "next/link";
import { FeatureList, PageIntro, Screenshot, Section } from "@/components/marketing";

export const metadata: Metadata = { title: "For retailers" };

export default function ForRetailers() {
  return (
    <>
      <PageIntro eyebrow="For kirana stores and retailers" title="Order stock for your shop without waiting for a call back.">
        Designed for your phone first.
      </PageIntro>
      <Section>
        <div className="grid items-start gap-12 lg:grid-cols-[1fr_auto]">
          <FeatureList
            items={[
              { title: "Find wholesalers nearby", body: "Search within 10, 25, 50 or 60 km using your location, city or PIN code. See who delivers to your shop." },
              { title: "One cart per wholesaler", body: "Items from different wholesalers are kept apart. Each wholesaler receives its own order with its own minimum order and delivery charge." },
              { title: "Buy in the right unit", body: "Order by the packet, box, carton, kilogram or cylinder, in the steps the wholesaler sells." },
              { title: "Track every order", body: "See when your order is accepted, prepared, out for delivery and delivered." },
              { title: "Reorder in one tap", body: "Repeat a previous order. Current prices and stock are checked again before you confirm." },
              { title: "Know what you owe", body: "Invoices, payments and the balance with each wholesaler in one place." },
            ]}
          />
          <div className="flex gap-4">
            <Screenshot mobile src="/screenshots/retailer-home-mobile.png" alt="Retailer home screen on a phone" width={390} height={844} />
          </div>
        </div>
        <Link href="/register?type=retailer" className="btn btn-primary mt-10">
          Create a retailer account
        </Link>
      </Section>
    </>
  );
}

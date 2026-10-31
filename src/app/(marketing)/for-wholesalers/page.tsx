import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand, FeatureList, PageIntro, Screenshot, Section } from "@/components/marketing";

export const metadata: Metadata = { title: "For wholesalers and distributors" };

export default function ForWholesalers() {
  return (
    <>
      <PageIntro eyebrow="For wholesalers and distributors" title="Fewer calls, fewer notebooks, fewer surprises at month end.">
        Built for distributors of FMCG goods, staples, beverages, bottled water, bakery items, household products and gas cylinders.
      </PageIntro>
      <Section>
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr]">
          <FeatureList
            items={[
              { title: "Know what to do next", body: "The overview lists orders waiting for you, deliveries in progress, low stock and overdue balances, for today, this week or this month." },
              { title: "Credit under control", body: "Set a credit limit per retailer. See ageing of what is owed: current, 1 to 30, 31 to 60, 61 to 90 and over 90 days." },
              { title: "Reports from your own records", body: "Sales by day, top products, collections by payment method and a GST summary for your accountant, exportable as CSV." },
              { title: "Purchasing", body: "Record purchase orders to your suppliers and receive goods into stock, with batch numbers and expiry dates." },
            ]}
          />
          <Screenshot src="/screenshots/wholesaler-inventory.png" alt="Inventory list with on-hand, reserved and available quantities" width={1280} height={860} />
        </div>
        <p className="mt-10 text-sm text-ink-muted">
          Gas cylinder distributors: products in the gas cylinder category ask delivery staff to confirm the empty cylinder pickup. VyaporaFlow does not manage PESO licensing or cylinder safety compliance.
        </p>
        <Link href="/register?type=wholesaler" className="btn btn-primary mt-6">
          Start with your business
        </Link>
      </Section>
      <CtaBand />
    </>
  );
}

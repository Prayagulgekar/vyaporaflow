import type { Metadata } from "next";
import { CtaBand, FeatureList, PageIntro, Screenshot, Section, SectionHeading } from "@/components/marketing";

export const metadata: Metadata = { title: "Features" };

export default function Features() {
  return (
    <>
      <PageIntro eyebrow="Features" title="Everything a distributor tracks, kept in one set of records.">
        Products, stock, orders, deliveries, invoices and payments are linked. A change in one place shows up everywhere it matters.
      </PageIntro>
      <Section>
        <SectionHeading title="Catalogue built for wholesale units" />
        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_1.1fr]">
          <FeatureList
            items={[
              { title: "Sell in more than one unit", body: "Stock is held in a base unit (piece, kg, litre). Sell the same item by the packet, box of 24 or carton of 48, each with its own price, MRP, minimum quantity and step." },
              { title: "Variants and attributes", body: "Sizes, flavours and pack weights as variants. Categories add fields such as shelf life, oil type or net gas weight." },
              { title: "HSN codes and GST rates", body: "Each product carries its HSN code and tax class. Rates are chosen by you; the app does not decide the correct rate for a product." },
              { title: "Import and export", body: "Bring in your product list from a spreadsheet (CSV), and export it again at any time." },
            ]}
          />
          <Screenshot src="/screenshots/wholesaler-products.png" alt="Product list with units, prices and stock" width={1280} height={860} />
        </div>
      </Section>
      <Section tone="sunken">
        <SectionHeading title="Stock, orders and delivery" />
        <div className="mt-8">
          <FeatureList
            items={[
              { title: "Reservations at order time", body: "Stock is reserved when a retailer places an order, so two retailers cannot both buy the last carton." },
              { title: "Movement history", body: "Every receipt, sale, return, damage write-off and correction is a dated entry. On-hand stock always equals the sum of its movements." },
              { title: "Batches and expiry", body: "Record batch numbers and expiry dates on receipts. Items expiring soon are listed." },
              { title: "Clear order stages", body: "Placed, accepted, preparing, ready, out for delivery, delivered, or cancelled. Prices are fixed on the order when it is placed." },
              { title: "Delivery assignments", body: "Assign orders to your delivery staff. They see only their own stops, with the address, items, amount to collect and empty cylinders to pick up." },
              { title: "Partial and failed deliveries", body: "Record what was actually delivered. Undelivered stock returns to inventory and, if already invoiced, a credit note is raised." },
            ]}
          />
        </div>
      </Section>
      <Section>
        <SectionHeading title="Billing, payments and balances" />
        <div className="mt-8 grid gap-10 lg:grid-cols-[1.1fr_1fr]">
          <Screenshot src="/screenshots/wholesaler-statement.png" alt="Retailer account statement with invoices, payments and running balance" width={1280} height={860} />
          <FeatureList
            items={[
              { title: "GST invoices", body: "CGST and SGST for supplies within your state, IGST across states, worked out from the two addresses. Sequential numbering per financial year." },
              { title: "Credit notes", body: "For returns, short deliveries or price corrections, linked to the original invoice." },
              { title: "Payments as they really happen", body: "Cash, UPI, bank transfer and cheque. Part payments, advances and payments that cover several invoices." },
              { title: "Reversals, not deletions", body: "A bounced cheque is reversed with a reason. Nothing financial is edited after the fact." },
              { title: "Statements that reconcile", body: "Each retailer's statement and balance come from a double-entry ledger, checked against invoices and payments." },
            ]}
          />
        </div>
      </Section>
      <Section tone="sunken">
        <SectionHeading title="Access and safety" />
        <div className="mt-8">
          <FeatureList
            items={[
              { title: "Roles for your team", body: "Owners and managers can change settings and money records. Staff handle orders and stock. Delivery staff see only their assigned deliveries." },
              { title: "Business data stays separate", body: "Every query is checked by the database itself, so one business can never read another's orders, prices or balances." },
              { title: "Audit trail", body: "Important changes, such as prices, payments, reversals and team changes, are written to an audit log." },
              { title: "Works on a phone", body: "The retailer and delivery screens are designed for small screens first." },
            ]}
          />
        </div>
      </Section>
      <CtaBand />
    </>
  );
}

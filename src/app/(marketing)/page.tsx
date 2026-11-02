import Image from "next/image";
import Link from "next/link";
import type { ComponentType, ReactNode, SVGProps } from "react";
import {
  ArchiveBoxIcon,
  ArrowRightIcon,
  BanknotesIcon,
  BuildingStorefrontIcon,
  ChartBarIcon,
  ChatBubbleLeftRightIcon,
  CheckIcon,
  ClipboardDocumentListIcon,
  DocumentTextIcon,
  DocumentArrowDownIcon,
  DevicePhoneMobileIcon,
  ExclamationTriangleIcon,
  FingerPrintIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ReceiptPercentIcon,
  ScaleIcon,
  ShoppingCartIcon,
  Squares2X2Icon,
  TruckIcon,
  UserGroupIcon,
  WalletIcon,
  ArrowsRightLeftIcon,
} from "@heroicons/react/24/outline";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/* -------------------------------------------------------------------------- */
/* Small building blocks                                                       */
/* -------------------------------------------------------------------------- */

function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[76rem] px-4 sm:px-6 ${className}`}>{children}</div>;
}

function Eyebrow({ children, tone = "green" }: { children: ReactNode; tone?: "green" | "blue" | "light" }) {
  const cls = tone === "light" ? "bg-white/10 text-[#9fe3c4] ring-white/15" : tone === "blue" ? "bg-info-soft text-info ring-[#c9dced]" : "bg-accent-soft text-accent ring-[#c6dfd2]";
  return <p className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase ring-1 ${cls}`}>{children}</p>;
}

function Heading({ eyebrow, title, children, center, tone }: { eyebrow: string; title: ReactNode; children?: ReactNode; center?: boolean; tone?: "green" | "blue" }) {
  return (
    <div className={`vf-reveal max-w-3xl ${center ? "mx-auto text-center" : ""}`}>
      <Eyebrow tone={tone}>{eyebrow}</Eyebrow>
      <h2 className="mt-4 font-display text-3xl leading-tight text-ink sm:text-[2.6rem]">{title}</h2>
      {children ? <div className="mt-4 text-lg text-ink-muted">{children}</div> : null}
    </div>
  );
}

function BrowserFrame({ src, alt, priority, label }: { src: string; alt: string; priority?: boolean; label: string }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-white/15 bg-white shadow-[0_30px_80px_rgb(4_20_30/0.45)]">
      <div className="flex items-center gap-1.5 border-b border-line bg-[#f4f1ec] px-3 py-2" aria-hidden>
        <span className="h-2.5 w-2.5 rounded-full bg-[#e0645b]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#e8b84a]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#5cb671]" />
        <span className="ml-3 truncate rounded bg-white px-2 py-0.5 text-[11px] text-ink-faint">{label}</span>
      </div>
      <Image src={src} alt={alt} width={1280} height={860} priority={priority} className="h-auto w-full" sizes="(min-width: 1024px) 680px, 100vw" />
    </figure>
  );
}

function PhoneFrame({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <figure className={`w-[150px] rounded-[26px] border border-black/10 bg-[#11161a] p-1.5 shadow-[0_24px_60px_rgb(4_20_30/0.45)] sm:w-[190px] ${className}`}>
      <Image src={src} alt={alt} width={390} height={844} className="h-auto w-full rounded-[20px]" sizes="190px" />
    </figure>
  );
}

function Chip({ icon: I, children, className = "" }: { icon: Icon; children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-xl border border-white/60 bg-white/95 px-3 py-2 text-xs font-semibold text-ink shadow-[0_12px_30px_rgb(4_20_30/0.25)] backdrop-blur ${className}`}>
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-soft text-accent"><I className="h-4 w-4" aria-hidden /></span>
      {children}
    </div>
  );
}

function Check({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><CheckIcon className="h-3.5 w-3.5" aria-hidden /></span>
      <span>{children}</span>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Content (only features that exist in this version of VyaporaFlow)          */
/* -------------------------------------------------------------------------- */

const PROBLEMS: { role: string; icon: Icon; tone: string; items: string[] }[] = [
  {
    role: "Wholesalers",
    icon: BuildingStorefrontIcon,
    tone: "bg-accent-soft text-accent",
    items: ["Orders arrive by phone calls, notes and chats", "Stock counts drift away from the shelves", "Retailer payments tracked in notebooks", "Deliveries coordinated one call at a time", "Invoices written up separately from the order"],
  },
  {
    role: "Retailers",
    icon: ShoppingCartIcon,
    tone: "bg-info-soft text-info",
    items: ["Hard to find reliable wholesalers nearby", "No easy view of what each supplier stocks", "Repeat orders rebuilt from memory", "Unsure what is still owed to whom", "Supplier details scattered across phones"],
  },
  {
    role: "Delivery partners",
    icon: TruckIcon,
    tone: "bg-[#fbefd9] text-warn",
    items: ["Stops handed over verbally", "No single place to see order status", "Cash collected recorded on paper slips", "Handing over cash with no clear record"],
  },
];

const ROLES: { id: string; eyebrow: string; title: string; body: string; icon: Icon; items: string[]; visual: ReactNode; tone: "green" | "blue" }[] = [
  {
    id: "wholesalers",
    eyebrow: "For wholesalers",
    title: "Run the whole distribution business from one workspace.",
    body: "From the catalogue to the cash in hand, every step updates the next, so stock, invoices and balances agree.",
    icon: BuildingStorefrontIcon,
    tone: "green",
    items: [
      "Product catalogue with HSN codes and GST rates",
      "Inventory with reservations, batches and expiry",
      "Multiple selling units and pack sizes per product",
      "Retailer approvals and credit limits",
      "Order management from placed to delivered",
      "Purchasing from your own suppliers",
      "GST invoices and credit notes",
      "Payments, part payments and advances",
      "Outstanding balances and account statements",
      "Cash collections and cash handovers",
      "Sales, collections and receivables reports",
    ],
    visual: <BrowserFrame src="/screenshots/wholesaler-orders.png" alt="Wholesaler order list with status, retailer and totals" label="Orders · VyaporaFlow" />,
  },
  {
    id: "retailers",
    eyebrow: "For retailers",
    title: "Order from your wholesalers in a few taps.",
    body: "Find suppliers near your shop, browse their catalogue in the units they sell, and keep track of every invoice and payment.",
    icon: ShoppingCartIcon,
    tone: "blue",
    items: [
      "Discover wholesalers near your shop",
      "Browse and search product catalogues",
      "A separate cart for each wholesaler",
      "Place and track orders by status",
      "View invoices and download them as PDFs",
      "See payments and balances per wholesaler",
      "Review account statements",
      "Contact wholesalers on WhatsApp",
    ],
    visual: (
      <div className="flex justify-center gap-4">
        <PhoneFrame src="/screenshots/retailer-catalog-mobile.png" alt="Retailer browsing a wholesaler's catalogue on a phone" />
        <PhoneFrame src="/screenshots/retailer-cart-mobile.png" alt="Retailer cart with totals and GST on a phone" className="mt-10 hidden sm:block" />
      </div>
    ),
  },
  {
    id: "delivery",
    eyebrow: "For delivery partners",
    title: "Every stop, collection and handover on the phone.",
    body: "Delivery staff see only their own assignments and record what really happened at each shop.",
    icon: TruckIcon,
    tone: "green",
    items: [
      "View assigned deliveries",
      "Delivery details: address, items, amount due",
      "Update status: out for delivery, delivered, failed",
      "Record delivered quantities for partial deliveries",
      "Record cash collections with a receipt",
      "Record UPI collections with a reference",
      "Track the cash you are holding",
      "Hand cash to the office and see each confirmed handover",
    ],
    visual: (
      <div className="flex flex-col items-center justify-center gap-6 sm:flex-row">
        <PhoneFrame src="/screenshots/delivery-mobile.png" alt="Delivery person's list of assigned stops on a phone" />
        <div className="w-full max-w-[260px] rounded-2xl border border-line bg-surface p-5 shadow-[0_14px_30px_rgb(15_49_80/0.08)]">
          <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">A delivery, step by step</p>
          <ol className="mt-4 space-y-3 text-sm">
            {[
              ["Assigned", "bg-info-soft text-info"],
              ["Out for delivery", "bg-info-soft text-info"],
              ["Delivered or partly delivered", "bg-accent-soft text-accent"],
              ["Cash or UPI collected", "bg-accent-soft text-accent"],
              ["Cash handed to the office", "bg-accent-soft text-accent"],
            ].map(([t, c], i) => (
              <li key={t} className="flex items-center gap-3">
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${c}`}>{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
        </div>
      </div>
    ),
  },
];

const FEATURES: { title: string; body: string; icon: Icon; isNew?: boolean }[] = [
  { title: "Inventory management", body: "Stock reserved at order time, deducted on delivery, with batches, expiry and a full movement history.", icon: ArchiveBoxIcon },
  { title: "Product catalogue", body: "Variants, HSN codes, tax classes and selling units from a single piece to a carton.", icon: Squares2X2Icon },
  { title: "Order management", body: "Clear stages from placed to delivered, with prices fixed on the order and every change recorded.", icon: ClipboardDocumentListIcon },
  { title: "Retailer marketplace", body: "Retailers search by GPS, city or PIN code and ask to connect with wholesalers near them.", icon: MagnifyingGlassIcon },
  { title: "Delivery management", body: "Assign orders to delivery staff and see each stop delivered, partly delivered or failed.", icon: TruckIcon },
  { title: "GST billing", body: "Tax invoices from delivered orders with CGST and SGST or IGST worked out from the addresses.", icon: ReceiptPercentIcon },
  { title: "Payments", body: "Cash, UPI, bank transfer and cheque payments, applied to invoices oldest first or by hand.", icon: BanknotesIcon },
  { title: "Outstanding balances", body: "Who owes what, what is overdue and since when, for every retailer.", icon: ScaleIcon },
  { title: "Cash collections", body: "Delivery staff record money collected at the shop, with a receipt and the balance left.", icon: WalletIcon },
  { title: "Cash handovers", body: "The office confirms cash received from each delivery person, and any shortfall stays visible.", icon: ArrowsRightLeftIcon },
  { title: "Financial reports", body: "Sales, collections by method and receivables for any period, with CSV exports.", icon: ChartBarIcon },
  { title: "Customer statements", body: "Invoices, credit notes, payments and reversals with a running balance.", icon: DocumentTextIcon },
  { title: "WhatsApp communication", body: "Prepared messages for orders, deliveries, invoices, payments and balances, sent to the right contact. WhatsApp opens with the message typed in; you review it and press Send.", icon: ChatBubbleLeftRightIcon, isNew: true },
  { title: "PDF documents", body: "Balance due, complete and monthly account statements, GST invoices and payment receipts as PDFs, to download, print or share on WhatsApp.", icon: DocumentArrowDownIcon, isNew: true },
];

const STEPS: { title: string; body: string; icon: Icon }[] = [
  { title: "Wholesaler adds products", body: "Catalogue, prices, units and opening stock.", icon: Squares2X2Icon },
  { title: "Retailer discovers and orders", body: "Finds the wholesaler, connects and places an order.", icon: ShoppingCartIcon },
  { title: "Wholesaler processes the order", body: "Accepts, prepares and marks it ready. Stock is reserved.", icon: ClipboardDocumentListIcon },
  { title: "Delivery partner is assigned", body: "The stop appears on their phone with items and address.", icon: UserGroupIcon },
  { title: "Delivery is completed", body: "Delivered in full or in part, or marked failed.", icon: TruckIcon },
  { title: "Collections are recorded", body: "Cash or UPI collected at the shop, then handed over.", icon: WalletIcon },
  { title: "Payments and balances update", body: "Invoices, payments and the retailer balance stay in step.", icon: ScaleIcon },
];

const FAQ: { q: string; a: ReactNode }[] = [
  { q: "What is VyaporaFlow?", a: "VyaporaFlow is a wholesale management platform and B2B marketplace for India. Wholesalers manage products, stock, orders, deliveries, GST invoices, payments and collections, and retailers order from them online." },
  { q: "Who can use it?", a: "Wholesalers and distributors (owners, managers and office staff), the retailers and shops they supply, and the delivery staff who carry the orders. Each person signs in with their own account and sees only what their role allows." },
  { q: "How do retailers order?", a: "A retailer finds wholesalers near their shop in the marketplace, asks to connect, and once approved browses the catalogue, adds products to a cart for that wholesaler and places the order. They can follow its status until it is delivered." },
  { q: "How are deliveries managed?", a: "The wholesaler assigns an order to a delivery person. The delivery person sees the stop on their phone, starts the delivery and records the result: delivered, partly delivered with the quantities, or failed." },
  { q: "How are payments recorded?", a: "Wholesalers record cash, UPI, bank transfer and cheque payments after they receive them, and delivery staff can record cash or UPI collected at the shop. There is no online payment gateway: VyaporaFlow records payments, it does not process them." },
  { q: "Can users generate invoices?", a: "Yes. A GST tax invoice is generated from a delivered order, with HSN codes and CGST and SGST or IGST. Invoices can be printed or downloaded as PDFs. VyaporaFlow does not generate e-invoices (IRN) or e-way bills or file GST returns." },
  { q: "Can users share account statements?", a: "Yes. Wholesalers can download a balance due statement, a complete account statement or a statement for a month or date range as a PDF, and share it on WhatsApp. Retailers can download their statement and invoices." },
  { q: "Does WhatsApp send messages automatically?", a: "No. VyaporaFlow opens WhatsApp with the right contact and a prepared message. You review it and press Send yourself. WhatsApp links cannot attach files, so PDFs are shared from your phone's share sheet or downloaded and attached in WhatsApp." },
  { q: "Does VyaporaFlow support mobile devices?", a: "Yes. It works in the browser on phones, tablets and computers. Retailer ordering and the delivery screens are designed for phones first." },
];

/* -------------------------------------------------------------------------- */

export default function Home() {
  return (
    <div className="vf-home">
      {/* 1. Hero */}
      <section className="vf-hero relative isolate overflow-hidden text-white" aria-labelledby="hero-title">
        <div className="vf-grid-lines pointer-events-none absolute inset-0 -z-10" aria-hidden />
        <Container className="grid items-center gap-12 py-16 sm:py-20 lg:grid-cols-[1fr_1.12fr] lg:py-24">
          <div className="vf-rise">
            <Eyebrow tone="light">Wholesale · Retail · Delivery</Eyebrow>
            <h1 id="hero-title" className="mt-5 font-display text-[2.6rem] leading-[1.05] sm:text-6xl">
              One Platform. Three Partners. <span className="vf-gradient-text">Smarter Business.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-white/80">
              VyaporaFlow connects wholesalers, retailers and delivery partners through one intelligent business platform. Manage products, orders, inventory, deliveries, invoices, payments and collections in one place.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register" className="btn bg-[#2fae7d] px-5 py-3 text-base text-white shadow-[0_10px_30px_rgb(47_174_125/0.35)] hover:bg-[#27996d]" data-testid="hero-get-started">
                Get Started <ArrowRightIcon className="h-4 w-4" aria-hidden />
              </Link>
              <a href="#features" className="btn border border-white/30 bg-white/10 px-5 py-3 text-base text-white hover:bg-white/20" data-testid="hero-features">
                Explore Features
              </a>
              <Link href="/marketplace" className="btn border border-white/30 bg-transparent px-5 py-3 text-base text-white hover:bg-white/10" data-testid="hero-marketplace">
                Explore Marketplace
              </Link>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/75">
              <li className="flex items-center gap-2"><CheckIcon className="h-4 w-4 text-[#7fe0b5]" aria-hidden />GST invoices</li>
              <li className="flex items-center gap-2"><CheckIcon className="h-4 w-4 text-[#7fe0b5]" aria-hidden />Cash on delivery tracking</li>
              <li className="flex items-center gap-2"><CheckIcon className="h-4 w-4 text-[#7fe0b5]" aria-hidden />Works on any phone</li>
            </ul>
          </div>
          <div className="vf-rise vf-rise-2 relative">
            <BrowserFrame src="/screenshots/wholesaler-overview.png" alt="Wholesaler overview with orders to act on, today's sales, outstanding payments and low stock" label="Overview · VyaporaFlow" priority />
            <div className="absolute -bottom-10 -left-2 hidden sm:block lg:-left-10">
              <PhoneFrame src="/screenshots/delivery-mobile.png" alt="Delivery person's stops on a phone" className="vf-float" />
            </div>
            <Chip icon={CheckIcon} className="vf-float-slow absolute -top-4 right-4 hidden md:flex">Order accepted · stock reserved</Chip>
            <Chip icon={DocumentArrowDownIcon} className="vf-float absolute right-[-0.5rem] bottom-10 hidden md:flex">Statement PDF ready to share</Chip>
          </div>
        </Container>
        <p className="pb-6 text-center text-xs text-white/50">Screens shown are from the VyaporaFlow demo workspace with fictional businesses.</p>
      </section>

      {/* 2. The business problem */}
      <section className="py-16 sm:py-24" aria-labelledby="problem-title">
        <Container>
          <Heading eyebrow="The everyday problem" title={<span id="problem-title">Wholesale still runs on phone calls, notebooks and memory.</span>} center>
            Three partners depend on each other every day, but each keeps their own records. Orders get missed, stock goes wrong and nobody is sure who owes what.
          </Heading>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {PROBLEMS.map((p) => (
              <article key={p.role} className="vf-card vf-reveal rounded-2xl border border-line bg-surface p-6">
                <div className="flex items-center gap-3">
                  <span className={`grid h-11 w-11 place-items-center rounded-xl ${p.tone}`}><p.icon className="h-6 w-6" aria-hidden /></span>
                  <h3 className="text-lg font-semibold">{p.role}</h3>
                </div>
                <ul className="mt-5 space-y-3 text-sm text-ink-muted">
                  {p.items.map((i) => (
                    <li key={i} className="flex gap-2.5"><ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />{i}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <p className="vf-reveal mx-auto mt-10 max-w-2xl text-center text-lg text-ink">
            <strong className="text-accent">VyaporaFlow puts all three on the same records</strong>, so an order placed by a shop, packed by the wholesaler and delivered by the driver is one story, start to finish.
          </p>
        </Container>
      </section>

      {/* 3. Three connected roles */}
      <section className="bg-sunken py-16 sm:py-24" aria-labelledby="roles-title">
        <Container>
          <Heading eyebrow="Three connected partners" title={<span id="roles-title">Built for everyone who moves wholesale goods.</span>} center tone="blue" />
          <div className="mt-14 space-y-20">
            {ROLES.map((r, i) => (
              <div key={r.id} id={r.id} className="grid items-center gap-10 lg:grid-cols-2">
                <div className={`vf-reveal ${i % 2 ? "lg:order-2" : ""}`}>
                  <Eyebrow tone={r.tone}><r.icon className="h-4 w-4" aria-hidden />{r.eyebrow}</Eyebrow>
                  <h3 className="mt-4 font-display text-3xl leading-tight">{r.title}</h3>
                  <p className="mt-3 text-ink-muted">{r.body}</p>
                  <ul className="mt-6 grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">{r.items.map((x) => <Check key={x}>{x}</Check>)}</ul>
                  <Link href={r.id === "wholesalers" ? "/for-wholesalers" : r.id === "retailers" ? "/for-retailers" : "/how-it-works"} className="link mt-6 inline-flex items-center gap-1">
                    {r.id === "wholesalers" ? "More for wholesalers" : r.id === "retailers" ? "More for retailers" : "See how deliveries work"} <ArrowRightIcon className="h-4 w-4" aria-hidden />
                  </Link>
                </div>
                <div className={`vf-reveal ${i % 2 ? "lg:order-1" : ""}`}>{r.visual}</div>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* 4. Feature overview */}
      <section id="features" className="py-16 sm:py-24" aria-labelledby="features-title">
        <Container>
          <Heading eyebrow="Everything in one place" title={<span id="features-title">Every part of the wholesale day, connected.</span>} center>
            Fourteen working modules that share one set of records.
          </Heading>
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f, i) => (
              <li key={f.title} className={`vf-card vf-reveal rounded-2xl border bg-surface p-5 ${f.isNew ? "border-[#b9d5c8] bg-gradient-to-br from-white to-accent-soft lg:col-span-2" : "border-line"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`grid h-10 w-10 place-items-center rounded-xl ${i % 3 === 1 ? "bg-info-soft text-info" : "bg-accent-soft text-accent"}`}><f.icon className="h-5 w-5" aria-hidden /></span>
                  {f.isNew ? <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">New</span> : null}
                </div>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm text-ink-muted">{f.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-center">
            <Link href="/features" className="btn btn-secondary">See all features in detail</Link>
          </p>
        </Container>
      </section>

      {/* 5. How it works */}
      <section id="how-it-works" className="bg-[#0f2f3a] py-16 text-white sm:py-24" aria-labelledby="flow-title">
        <Container>
          <div className="vf-reveal mx-auto max-w-3xl text-center">
            <Eyebrow tone="light">How VyaporaFlow works</Eyebrow>
            <h2 id="flow-title" className="mt-4 font-display text-3xl leading-tight sm:text-[2.6rem]">From the shelf to the shop to the books.</h2>
            <p className="mt-4 text-lg text-white/75">Seven steps, one record. Each step updates the next automatically.</p>
          </div>
          <ol className="relative mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-7 lg:gap-3">
            <div className="absolute top-7 right-[7%] left-[7%] hidden h-px bg-gradient-to-r from-[#2fae7d] via-[#5aa7e0] to-[#2fae7d] lg:block" aria-hidden />
            {STEPS.map((s, i) => (
              <li key={s.title} className="vf-reveal relative flex gap-4 lg:flex-col lg:items-center lg:gap-3 lg:text-center">
                <span className="relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#2fae7d] to-[#1e5a88] shadow-[0_10px_30px_rgb(47_174_125/0.3)]">
                  <s.icon className="h-6 w-6" aria-hidden />
                  <span className="absolute -top-2 -right-2 grid h-6 w-6 place-items-center rounded-full bg-white text-xs font-bold text-[#0f2f3a]">{i + 1}</span>
                </span>
                <div>
                  <h3 className="font-semibold">{s.title}</h3>
                  <p className="mt-1 text-sm text-white/70">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-12 text-center"><Link href="/how-it-works" className="btn border border-white/30 bg-white/10 text-white hover:bg-white/20">Read the full walkthrough</Link></p>
        </Container>
      </section>

      {/* 6. Financial transparency */}
      <section className="py-16 sm:py-24" aria-labelledby="money-title">
        <Container className="grid items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <Heading eyebrow="Financial transparency" title={<span id="money-title">Every rupee accounted for, from invoice to handover.</span>}>
              Money is recorded the way it moves. Invoices, payments, collections and handovers are linked to each other and posted to a double-entry ledger that the balances are checked against.
            </Heading>
            <dl className="vf-reveal mt-8 grid gap-4 sm:grid-cols-2">
              {[
                ["Invoices", "GST invoices raised from delivered orders, with credit notes for returns and corrections."],
                ["Payments", "Every payment applied to invoices, oldest first or by hand, with reversals kept on record."],
                ["Outstanding balances", "What each retailer owes, what is overdue and any advance not yet applied."],
                ["Account statements", "Every document with debit, credit and a running balance, also as a PDF."],
                ["Cash collections", "Cash and UPI collected on delivery, each with its own receipt."],
                ["Cash handovers", "Cash moved from the delivery person to the office, with shortfalls kept visible."],
              ].map(([t, d]) => (
                <div key={t} className="rounded-xl border border-line bg-surface p-4">
                  <dt className="flex items-center gap-2 font-semibold"><CheckIcon className="h-4 w-4 text-accent" aria-hidden />{t}</dt>
                  <dd className="mt-1 text-sm text-ink-muted">{d}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="vf-reveal">
            <figure className="overflow-hidden rounded-xl border border-line-strong bg-surface shadow-[0_24px_60px_rgb(15_49_80/0.15)]">
              <Image src="/screenshots/wholesaler-statement.png" alt="Customer account statement with invoices, payments and running balance" width={1280} height={860} className="h-auto w-full" sizes="(min-width: 1024px) 620px, 100vw" />
            </figure>
            <p className="mt-3 text-center text-xs text-ink-muted">Customer statement and payment tracking, from the demo workspace</p>
          </div>
        </Container>
      </section>

      {/* 7. Security and access */}
      <section className="bg-sunken py-16 sm:py-24" aria-labelledby="security-title">
        <Container>
          <Heading eyebrow="Security and access" title={<span id="security-title">Each person sees only what their role needs.</span>} center tone="blue">
            Access rules are enforced in the database itself, not just hidden in the screens.
          </Heading>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {[
              { icon: UserGroupIcon, title: "Role-based access", body: "Owners, managers, office staff and delivery staff each get the actions their role allows. Delivery staff see only their own assigned deliveries." },
              { icon: LockClosedIcon, title: "Business data separation", body: "Every business's products, orders, invoices and payments are kept apart by row-level security in the database. Retailers see only their own orders, invoices and balances." },
              { icon: FingerPrintIcon, title: "Audit trail", body: "Order and delivery history records who did what and when. Sensitive changes such as prices, payments, reversals and team changes go to an append-only audit log." },
            ].map((c) => (
              <article key={c.title} className="vf-card vf-reveal rounded-2xl border border-line bg-surface p-6">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-info-soft text-info"><c.icon className="h-6 w-6" aria-hidden /></span>
                <h3 className="mt-4 text-lg font-semibold">{c.title}</h3>
                <p className="mt-2 text-sm text-ink-muted">{c.body}</p>
              </article>
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-ink-muted">VyaporaFlow does not claim any security certification. Read the <Link href="/privacy" className="link">privacy policy</Link> for how data is handled.</p>
        </Container>
      </section>

      {/* 8. Screenshots */}
      <section className="py-16 sm:py-24" aria-labelledby="preview-title">
        <Container>
          <Heading eyebrow="Product preview" title={<span id="preview-title">See VyaporaFlow at work.</span>} center>
            Real screens from the demo workspace, on the desktop and on the phone.
          </Heading>
          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {[
              { src: "/screenshots/wholesaler-inventory.png", alt: "Inventory with on-hand, reserved and available stock", caption: "Inventory and stock levels" },
              { src: "/screenshots/wholesaler-products.png", alt: "Product list with units, prices and stock", caption: "Product catalogue" },
              { src: "/screenshots/marketplace.png", alt: "Marketplace search results for wholesalers near a PIN code", caption: "Retailer marketplace" },
            ].map((s) => (
              <figure key={s.src} className="vf-card vf-reveal overflow-hidden rounded-2xl border border-line bg-surface">
                <Image src={s.src} alt={s.alt} width={1280} height={860} className="h-auto w-full border-b border-line" sizes="(min-width: 1024px) 400px, 100vw" />
                <figcaption className="px-4 py-3 text-sm font-medium">{s.caption}</figcaption>
              </figure>
            ))}
          </div>
          <div className="vf-reveal mt-8 flex flex-wrap items-end justify-center gap-5">
            <PhoneFrame src="/screenshots/retailer-home-mobile.png" alt="Retailer home on a phone" />
            <PhoneFrame src="/screenshots/retailer-catalog-mobile.png" alt="Retailer catalogue on a phone" />
            <PhoneFrame src="/screenshots/retailer-cart-mobile.png" alt="Retailer cart on a phone" className="hidden sm:block" />
            <PhoneFrame src="/screenshots/delivery-mobile.png" alt="Delivery stops on a phone" className="hidden md:block" />
          </div>
        </Container>
      </section>

      {/* 9. FAQ */}
      <section id="faq" className="bg-sunken py-16 sm:py-24" aria-labelledby="faq-title">
        <Container className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <Heading eyebrow="Questions" title={<span id="faq-title">Frequently asked questions.</span>}>
            Can&apos;t find your answer? <Link href="/contact" className="link">Contact us</Link>.
          </Heading>
          <div className="space-y-3">
            {FAQ.map((f) => (
              <details key={f.q} className="vf-faq rounded-xl border border-line bg-surface">
                <summary className="flex items-center justify-between gap-4 px-5 py-4 font-semibold">
                  {f.q}
                  <PlusIcon className="vf-chev h-5 w-5 shrink-0 text-accent" aria-hidden />
                </summary>
                <div className="px-5 pb-5 text-sm text-ink-muted">{f.a}</div>
              </details>
            ))}
          </div>
        </Container>
      </section>

      {/* 10. Final call to action */}
      <section className="py-16 sm:py-20" aria-labelledby="cta-title">
        <Container>
          <div className="vf-hero vf-reveal relative isolate overflow-hidden rounded-3xl px-6 py-14 text-center text-white sm:px-12">
            <div className="vf-grid-lines pointer-events-none absolute inset-0 -z-10" aria-hidden />
            <DevicePhoneMobileIcon className="mx-auto h-10 w-10 text-[#7fe0b5]" aria-hidden />
            <h2 id="cta-title" className="mx-auto mt-4 max-w-2xl font-display text-3xl leading-tight sm:text-5xl">Bring Your Wholesale Business Together.</h2>
            <p className="mx-auto mt-4 max-w-xl text-white/80">Set up your business, add your products and invite your team. Retailers near you can find you and order the same day.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/register?type=wholesaler" className="btn bg-[#2fae7d] px-5 py-3 text-base text-white hover:bg-[#27996d]" data-testid="cta-start">Start Your Business</Link>
              <Link href="/marketplace" className="btn border border-white/30 bg-white/10 px-5 py-3 text-base text-white hover:bg-white/20" data-testid="cta-marketplace">Explore Marketplace</Link>
            </div>
          </div>
        </Container>
      </section>
    </div>
  );
}

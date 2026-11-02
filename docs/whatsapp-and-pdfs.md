# WhatsApp messages, PDF documents and the new homepage

Update of 2 November 2026. Built on `vyaporaflow-cash-collections.zip` (29 October 2026). **No database migration, no new environment variable and no change to Supabase, login, roles, RLS, GST calculations or existing API routes.**

## 1. WhatsApp messaging (central system)

VyaporaFlow never sends WhatsApp messages by itself. Every WhatsApp button now:

1. picks the right person (the retailer's contact, the wholesaler, or the delivery person);
2. reads their saved number and converts it to the form WhatsApp needs;
3. builds the message from real data (names, order and invoice numbers, amounts, due dates);
4. encodes it correctly (₹, line breaks, &, #, + and emoji all survive);
5. opens WhatsApp with that chat and the message typed in;
6. you check it and press **Send** yourself.

On a computer it opens **WhatsApp Web** (the Windows WhatsApp app sometimes opens the chat but drops the message). On a phone it opens the **WhatsApp app** (wa.me). The message is also copied, so you can paste it if a WhatsApp app ignores it.

**Phone numbers.** `98765 43210`, `098765-43210`, `+91 98765 43210`, `91 9876543210`, `0091 98765 43210` and `+91 (0) 98765 43210` all become `919876543210`. Landlines, short numbers and numbers that cannot be Indian mobiles (must start 6–9) are refused with a message such as *"The number saved for Laxmi Provision Mart (1234567890) is not a valid mobile number for WhatsApp"*, instead of opening a broken chat. Other countries work when typed with `+` and the country code.

**Where the buttons are**

| Page | Who is messaged | Messages offered |
|---|---|---|
| Retailer profile (`/w/retailers/…`) | retailer contact | Outstanding balance reminder, Account statement, General |
| Order (`/w/orders/…`), Retailer card | retailer contact | Order confirmation, Order accepted, Order dispatched, Delivery completed, Partial delivery (lists short items), Delivery failed (with the recorded reason), General. The default follows the order's state. |
| Order (`/w/orders/…`), Delivery card | the assigned delivery person | Delivery assignment (shop, contact, address, items, order value), General |
| Invoice (`/w/billing/…`) | retailer contact | Share invoice, Payment reminder (marked overdue when it is) |
| Payment (`/w/payments/…`) | retailer contact | Payment received confirmation, Payment receipt |
| Cash collection (`/w/cash-collections/…`) | retailer contact | Cash/UPI collection confirmation (with the balance still due on the order), General |
| Retailer's order (`/r/orders/…`) | wholesaler | New order notification, General |
| My wholesalers, wholesaler catalogue, marketplace profile | wholesaler | General (shown only when the wholesaler has a valid number, as before) |

The 16 message types live in one file, `src/lib/whatsapp-messages.ts`. A line is left out when its value is not available; no amount is ever estimated.

## 2. PDF documents

| Document | Where | File name |
|---|---|---|
| **Balance due statement** | Retailer profile → **Send balance due** | `Balance-Due-<Shop>-<date>.pdf` |
| **Complete account statement** | Retailer profile → **Statements (PDF)** | `Account-Statement-<Shop>-as-of-<date>.pdf` |
| **Monthly / date-range statement** | same page, choose a month or From/To | `Monthly-Statement-<Shop>-<from>-to-<to>.pdf` |
| **GST tax invoice** | Invoice page → **Download PDF** (wholesaler and retailer) | `Tax-Invoice-INV-26-27-00011.pdf` |
| **Payment receipt** | Payment page → **Receipt PDF** | `Payment-Receipt-RCPT-000007.pdf` |
| Retailer's statement | Retailer: Payments and balances → choose a wholesaler → **Download statement PDF** | `Account-Statement-…pdf` |

- **Same numbers as the app.** Balance due uses the existing retailer balance (invoiced − credit notes − payments) and the open invoices with their due dates; overdue = amount due on invoices past their due date. Statements use the existing statement lines and running balance; a month or date range only selects lines, with the opening balance taken from the last line before the period. The invoice prints the stored invoice values; GST is not recalculated.
- **Clearly labelled.** Balance due and statements say *"not a tax invoice"*. The invoice keeps the existing wording *"This is not an e-invoice (no IRN)"*; a void invoice carries a VOID watermark; a reversed payment's receipt says REVERSED.
- **Professional layout.** A4, VyaporaFlow green/blue branding, ₹ amounts in Indian format (₹1,23,456.78), tables that continue on the next page with the header repeated, "Page x of y", readable on phones and printable.
- **Private.** PDFs are generated on request for the signed-in user only, through the same database security as the screens. Another company's document returns "not found".

## 3. Sharing a PDF on WhatsApp

Retailer profile → **Send balance due** opens the **Documents and sharing** page with three panels (balance due, complete statement, monthly/date range). Each has:

- **Share on WhatsApp**
  - *Phones that can share files* (most Android Chrome and iPhone Safari): the PDF goes to the phone's share sheet. Choose WhatsApp, pick the customer's chat, press Send. The prepared message goes with it.
  - *Computers and other browsers*: WhatsApp opens on the customer's chat with the message typed in, **and** the PDF downloads. In WhatsApp click the paperclip → **Document**, choose the downloaded PDF, press Send.
- **Download PDF**, **View PDF**, and **Share PDF…** (any app, when the device supports it).

A WhatsApp link can carry text only, never a file, so the app never claims a PDF was sent. The invoice and payment pages have the same panel ("Prepare PDF to share").

## 4. New public homepage

`/` now has: hero (*One Platform. Three Partners. Smarter Business.*, Get Started / Explore Features / Explore Marketplace), the everyday problem for each partner, the three roles with real screenshots and their features, 14 feature cards, a 7-step flow diagram, financial transparency, security and access, product preview, FAQ (including *Does WhatsApp send messages automatically? No*), the final call to action (*Bring Your Wholesale Business Together.*) and a footer with Features, Pricing, How It Works, For Wholesalers, For Retailers, Marketplace, Contact, Privacy Policy and Terms. Only existing features are described; there are no testimonials, statistics or certifications. Motion is CSS-only and stops for people who turn on "reduce motion". The other marketing pages and the app dashboards are unchanged.

## 5. Files

**New**

- `src/lib/whatsapp.ts`: phone normalisation, validation and WhatsApp links
- `src/lib/whatsapp-messages.ts`: the 16 message templates
- `src/components/whatsapp.tsx`: WhatsApp button and message composer
- `src/components/document-share.tsx`: download / share sheet / WhatsApp panel
- `src/features/shared/whatsapp-options.ts`: which messages each page offers
- `src/domain/statement-period.ts`: month and date-range selection of statement lines
- `src/server/documents.ts`: loads the data and lays out the five PDFs
- `src/server/pdf/layout.ts`, `src/server/pdf/response.ts`: PDF layout engine and download response
- `src/server/pdf/fonts/noto-sans.ts`, `OFL-NotoSans.txt`: embedded Noto Sans font with ₹ (Open Font License)
- `src/app/w/documents/[kind]/[id]/route.ts`, `src/app/r/documents/[kind]/[id]/route.ts`: PDF downloads
- `src/app/w/retailers/[id]/documents/page.tsx`: Documents and sharing page
- `tests/unit/whatsapp.test.ts`, `tests/integration/documents.test.ts`, `tests/e2e/i-whatsapp-documents.spec.ts`, `tests/e2e/j-homepage.spec.ts`
- `docs/whatsapp-and-pdfs.md` (this file), `docs/update-whatsapp-pdf-homepage-windows.md`

**Changed**

- `package.json`, `package-lock.json`: added `pdf-lib` 1.17.1 and `@pdf-lib/fontkit` 1.1.1 (free, MIT, pure JavaScript)
- `src/lib/format.ts`: `whatsappLink` now uses the central helper (same link format, but refuses invalid numbers)
- WhatsApp buttons switched to the central system: `src/app/w/retailers/[id]/page.tsx`, `src/app/w/orders/[id]/page.tsx`, `src/app/w/billing/[id]/page.tsx`, `src/app/w/payments/[id]/page.tsx`, `src/app/w/cash-collections/[id]/page.tsx`, `src/app/r/orders/[id]/page.tsx`, `src/app/r/wholesalers/page.tsx`, `src/app/r/wholesalers/[id]/page.tsx`, `src/app/(marketing)/marketplace/[slug]/page.tsx`
- PDF links added: `src/app/r/invoices/[id]/page.tsx`, `src/app/r/payments/page.tsx`
- Homepage: `src/app/(marketing)/page.tsx` (rewritten), `src/app/(marketing)/layout.tsx` (footer links only), `src/app/globals.css` (homepage styles appended, scoped to the homepage)
- `tests/e2e/b-retailer.spec.ts`: one line, it checked the old homepage headline and now checks the new one
- `README.md`, `docs/testing.md`: links and test descriptions

**Not changed:** `supabase/` (migrations, seed, config), authentication, `src/proxy.ts`, `src/server/billing.ts`, orders, inventory, deliveries, collections, GST/tax code, roles, RLS, existing API routes, reports and the app dashboards' design.

## 6. Test results (2 November 2026)

| Check | Before (baseline) | After |
|---|---|---|
| `npm run typecheck` | pass | pass |
| `npm run lint` | pass | pass |
| `npm run build` | pass | pass |
| `npm run test:unit` | 50 passed | 100 passed (50 new) |
| `npm run test:integration` (PGlite) | 59 passed, 8 skipped | 72 passed, 8 skipped (13 new) |
| `npm run test:pg` (PostgreSQL 16, throwaway databases) | 66 passed, 1 skipped | 79 passed, 1 skipped |
| `npm run test:security` (RLS) | 18 passed | 18 passed |
| `npm run test:e2e` (Chromium, demo database) | 20 passed | 35 passed (15 new) |
| `npm audit --omit=dev` | | 0 vulnerabilities |

The 8 skipped PGlite tests are the PostgreSQL-only concurrency tests (they ran under `test:pg`); the 1 skipped under `test:pg` was skipped before the update too. All tests used local throwaway databases; no hosted Supabase project was touched. PDF text was checked with `pdftotext`. Not tested: a real WhatsApp account (WhatsApp was stubbed), a real phone's share sheet (simulated in the browser), and Windows itself (tests ran on Linux).

## 7. Limitations

- WhatsApp links cannot attach files and nothing is sent automatically. On a computer the PDF must be attached by hand in WhatsApp.
- When sharing through the phone's share sheet, you choose the WhatsApp chat yourself (the share sheet cannot preselect a contact).
- PDFs use an English/Latin font. Names typed in Indian scripts (for example Devanagari) print as "?" in PDFs; the screens are unaffected.
- The GST invoice PDF is the same computer-generated invoice as before: no e-invoice (IRN/QR), no e-way bill.
- PDFs show no bank or UPI payment details because the app does not store them yet.
- The homepage screenshots are the existing demo screenshots; the new Documents page is not pictured.

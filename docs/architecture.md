# Architecture

## Main decisions

| Decision | Choice | Why |
|---|---|---|
| Framework | Next.js 16 App Router, React 19 Server Components, server actions | One deployable app; data loading and mutations stay on the server |
| Language | TypeScript, `strict` | |
| Styling | Tailwind CSS 4 with design tokens in `src/app/globals.css` | |
| Database | PostgreSQL (Supabase in production, PGlite or local PostgreSQL in demo) | RLS, transactions, row locks, exact `numeric` |
| Data access | Plain SQL through one small layer (`src/server/db`) | Same code path in both modes; no ORM hides which role runs a query |
| Business rules | PL/pgSQL `app.*` functions plus pure TypeScript in `src/domain` | Rules that must be atomic or tamper-proof run in the database; the TypeScript mirror is for display and is tested for parity |
| Validation | zod at every server entry point | |
| Auth | Supabase Auth (production); local sessions table (demo) | |
| Icons | Heroicons | |

## Request flow

1. A page, server action or `/api` route calls `getViewer()` / `requireWholesaler()` etc. (`src/server/viewer.ts`). These resolve the session, the user's memberships and the active company (cookie `vf_company`, validated against memberships).
2. The feature module (for example `src/server/orders.ts`) validates input with zod.
3. `userTx(userId, fn)` opens a transaction, sets `request.jwt.claims` and `SET LOCAL ROLE authenticated`. Inside, `auth.uid()` is the user and RLS applies to every statement.
4. Mutations call `app.*` functions (`SECURITY DEFINER`, fixed `search_path`). Each function re-checks the caller's membership and role before doing anything.
5. Database errors with codes `VF401`/`VF403`/`VF404`/`VF409`/`VF422` become typed `AppError`s; server actions return `{ ok, message, fieldErrors }` to the form.

## Data model (main tables)

- **Identity and tenancy:** `profiles` (one per auth user), `companies` (kind `wholesaler` or `retailer`), `company_memberships` (role `owner`, `manager`, `staff`, `delivery_worker`), `company_invitations` (hashed tokens), `platform_admins`.
- **Business profile:** `business_addresses`, `wholesaler_profiles` (minimum order, delivery charge, free-delivery threshold, auto-approve, payment terms, opening hours), `retailer_profiles`, `delivery_zones` (radius or PIN code lists).
- **Relationships:** `retailer_wholesaler_relationships` (`pending`, `approved`, `rejected`, `blocked`, credit limit). Wholesalers that do not auto-approve show prices only to approved retailers.
- **Catalogue:** `product_categories` (with an attribute schema and workflow flags such as empty-cylinder return), `brands`, `tax_classes`, `products`, `product_variants` (SKU, stock unit), `variant_units` (selling units such as piece, box, carton with a pack size, price, MRP, discount, minimum quantity and step).
- **Inventory:** `inventory_locations`, `inventory_balances` (`on_hand`, `reserved`, generated `available`, checks that stop negative stock and over-reservation), `stock_movements` (append-only), `product_batches` (batch and expiry).
- **Orders:** `cart_items` (one cart per retailer per wholesaler), `orders` (totals, delivery address snapshot, idempotency key), `order_items` (product, unit, price, tax snapshots), `order_events` (append-only).
- **Billing:** `invoices` and `invoice_items` (seller and buyer snapshots, HSN, CGST/SGST/IGST), `credit_notes`, `payments`, `payment_allocations`, `payment_reversals`.
- **Ledger:** `journal_entries`, `journal_lines` (double entry per wholesaler: AR, sales, output CGST/SGST/IGST, delivery income, sales returns, cash/bank/UPI/cheque, and cash in transit with delivery staff). `app.reconcile_receivables()` compares the ledger with the document balances.
- **Delivery:** `deliveries`, `delivery_assignments` (history of who was assigned), `delivery_events`.
- **Delivery cash:** `delivery_collections` (money a worker collected on a delivery; a non-zero one is also a normal `payments` row), `cash_handovers` and `cash_handover_items` (cash handed from a worker to the office, with any shortfall). See [cash-collections.md](cash-collections.md).
- **Purchasing:** `suppliers`, `purchase_orders`, `purchase_order_items`, `goods_receipts`, `goods_receipt_items`.
- **Platform:** `notifications`, `audit_logs`, `support_requests`, `platform_settings`.

Views (all `security_invoker`, so RLS still applies): `invoice_balances`, `payment_balances`, `retailer_balances`, `order_overview`, `inventory_overview`, `my_deliveries`, `delivery_collection_balances`.

## Order lifecycle

```
placed ─► accepted ─► preparing ─► ready_for_delivery ─► out_for_delivery ─► delivered
   │          │            │               │                    │
   └──────────┴────────────┴───────────────┴──► cancelled        └─► ready_for_delivery (failed attempt)
```

- **Placing** (`app.place_order`): takes only selling-unit IDs and quantities. Locks the stock rows (`for update`), re-prices every line from the database, checks the relationship, minimum order value, quantity rules and stock, then reserves stock. An advisory lock plus a unique `(retailer_id, idempotency_key)` makes retries return the same order.
- **Cancelling** releases the reservation. **Delivering** converts the reservation into a stock deduction (partial deliveries deduct what was delivered and release the rest).
- Every change writes an `order_events` row. Events cannot be updated or deleted.
- Line snapshots (name, SKU, unit, price, tax rate, HSN) keep old orders and invoices correct when the catalogue changes.

## Money and tax

- `numeric(14,2)` in the database; exact decimal strings and `BigInt` paise in TypeScript (`src/domain/money.ts`). No floating-point arithmetic on money.
- Line: `amount = round(qty × unit price, 2)`, `discount = round(amount × % / 100, 2)`, then tax either added (`round(net × rate / 100, 2)`) or extracted from tax-inclusive prices. The SQL `app.calc_line` and TypeScript `calcLine` are tested for identical results.
- Intra-state supply (seller and place of supply in the same state) splits tax into CGST (rounded) and SGST (remainder); inter-state uses IGST.
- Invoice numbers follow `INV/<FY>/<00001>` per wholesaler and financial year (April to March, Indian time). Credit notes `CN/...`, payments `RCPT-...`, delivery collections `COL-...`, cash handovers `HO-...`.

## Marketplace search

- Location comes from the retailer's shop address, a PIN code, a city or (opt-in) device GPS. PIN codes and cities resolve through the bundled `geo_places` table.
- Search radius 10, 25, 50 (default) or 60 km. Distance uses PostGIS `ST_DWithin` when available, otherwise a bounding box plus haversine.
- **Delivery coverage is separate from search radius**: each result says whether that wholesaler delivers to the location (their own radius or PIN code zones), so a wholesaler can appear in a 50 km search but show "pickup only" or "does not deliver here".
- Suspended and unlisted companies never appear.

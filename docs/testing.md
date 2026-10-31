# Testing

| Command | Runner | Database |
|---|---|---|
| `npm run test:unit` | Vitest, `tests/unit` | none |
| `npm run test:integration` | Vitest, `tests/integration` | a fresh in-memory PGlite per file, with all migrations and the demo seed |
| `npm run test:security` | Vitest, `tests/integration/rls.test.ts` | same |
| `npm run test:pg` | Vitest, `tests/integration` | a fresh `vf_test_<random>` database per file on `TEST_DATABASE_URL`, dropped afterwards |
| `npm run test:e2e` | Playwright, `tests/e2e` | a fresh PGlite demo database in `.data/e2e`, app on port 3100 |

No test touches your normal demo database (`.data/pglite`) or any production database. `TEST_DATABASE_URL` must point at a disposable local server, for example:

```bash
# Ubuntu/Debian: sudo service postgresql start
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:pg
```

The user in that URL needs permission to create databases. PostGIS is used if installed.

## Unit tests (`tests/unit`)

- `money.test.ts`: parsing, exact paise arithmetic, rounding half-up, Indian number formatting.
- `pricing-tax.test.ts`: line pricing (exclusive and inclusive GST), discounts, delivery charges and free-delivery threshold, CGST/SGST/IGST split, GSTIN format, financial-year labels in IST.
- `units-billing.test.ts`: unit conversion, minimum quantity and step validation, invoice totals, payment allocation (oldest first and manual), outstanding balances.
- `rules.test.ts`: order-state transitions, role permissions, distance and radius rules, environment validation (including the `NEXT_PUBLIC_` secret check), CSV escaping, WhatsApp links.

## Integration tests (`tests/integration`)

All calls go through the real server modules as real users, so RLS applies.

- `business-flow.test.ts`: product creation with opening stock; stock additions, write-offs and the refusal to go negative; duplicate SKU; separate carts; minimum order value; SQL vs TypeScript pricing parity over awkward inputs; client prices ignored; order placement reserving stock; idempotent resubmission; cancellation releasing stock; lifecycle with forbidden skips and role checks; append-only events; GST invoice (CGST/SGST, HSN, numbering, no duplicate); immutable invoice totals; delivery assignment limited to the company's workers; delivery completion deducting stock; partial payment, idempotent payment, over-allocation refused, reversal; ledger reconciliation and balanced journal entries; confirmed order totals cannot be edited.
- `rls.test.ts`: the nine required cases:
  1. Wholesaler A cannot read or change Wholesaler B's inventory.
  2. Wholesaler A cannot read Wholesaler B's orders.
  3. A retailer cannot read another retailer's invoices or payments.
  4. An unapproved retailer cannot order from (or see prices of) a wholesaler that requires approval.
  5. A delivery worker cannot read unrelated deliveries, invoices, payments or stock.
  6. A delivery worker cannot update an unassigned delivery (function or direct update).
  7. Users cannot grant themselves admin, promote themselves to owner, or join a company directly; admin functions refuse non-admins.
  8. Anonymous users read no private table and cannot call business functions; they see only the public listing, without suspended companies.
  9. A user cannot place orders, carts or products under another company's ID, move rows between tenants, or see anything with forged claims for an unknown user.
- `cash-collections.test.ts`: delivery cash collection and handover. Case 1 (₹200 order, ₹100 collected), case 2 (₹300, ₹200), case 3 (combined: ₹500 value, ₹300 collected, shop owes ₹200, ₹300 pending), case 4 (handover clears pending, shop balance unchanged, no new payment), case 5 (₹250 of ₹300: ₹50 pending, discrepancy recorded, oldest collection covered first), case 6 (₹0: delivered, no payment), case 7 (duplicate collection: one payment), case 8 (duplicate handover: one handover), case 9 (another worker: no access), case 10 (another company: no access), case 12 (an office advance stays intact and unlinked), case 13 (collected on an invoiced order: applied to that invoice), case 14 (delivered without collection: no payment); also over-collection refused, a refused collection leaves the delivery undelivered, UPI needs a reference and skips handover, same-minute and future times, handover and payment reversals, ledger reconciliation and `CASH_IN_TRANSIT` equal to cash pending, and no direct writes to the new tables.
- `concurrency.test.ts` (PostgreSQL only; reported as skipped without `TEST_DATABASE_URL`): ten simultaneous one-unit orders for five units (exactly five succeed); two buyers racing for the last three units with two each (exactly one wins); six concurrent duplicate order submissions (one order, one reservation); six concurrent duplicate payments (one payment); eight concurrent write-offs never drive stock negative; six simultaneous handovers of the same cash (case 11: exactly one succeeds, nothing handed over twice); six simultaneous identical collection submissions (one collection, one payment).

## End-to-end workflows (`tests/e2e`)

Playwright starts `scripts/e2e-server.ts`, which deletes `.data/e2e`, creates a fresh demo database, builds the app if there is no build (set `E2E_BUILD=1` to force a rebuild) and serves it with `next start` on port 3100. Run `npx playwright install chromium` once.

- **A, wholesaler** (`a-wholesaler.spec.ts`): log in, dashboard, create a product with price and opening stock, see it in inventory, a retailer orders it, find the order among placed orders, accept, prepare, mark ready, assign a delivery worker, the worker delivers, generate the GST invoice, record a ₹500 payment, outstanding balance falls by exactly ₹500.
- **B, retailer** (`b-retailer.spec.ts`): register a new retailer, onboard the shop, discover wholesalers within 50 km (suspended company hidden), connect, open the catalogue, add two products, check the cart total meets the minimum, place the order, see it as Placed with the same total; then as a seeded retailer open an invoice (GST, HSN) and the payment history.
- **C, delivery worker** (`c-delivery.spec.ts`, phone viewport): an order is assigned to the worker, the worker sees it, opens it, starts it, completes it, the history shows each step with their name, it moves to Completed and can no longer be changed.
- **D, security** (`d-security.spec.ts`): another company's order, product and invoice pages and API return 404, signed-out visitors are redirected and the API returns 401; a pending retailer's order and a forged retailer ID are refused, cross-site API requests are refused; a worker cannot open another worker's delivery and a tampered form targeting it is rejected while the delivery stays unchanged; client-sent prices and totals are ignored and there is no endpoint to edit a placed order; a tampered "admin" account type is rejected at registration and business users cannot open `/admin`.
- **E, concurrency** (`e-concurrency.spec.ts`): eight simultaneous API orders from two shops for three units (exactly three succeed, stock shows 3 reserved and 0 available); five duplicate submissions with one key return one order; a payment form submitted twice in the same tick records one payment. PGlite serializes transactions, so the true parallel database tests are in `concurrency.test.ts`.

- **Forms** (`f-forms.spec.ts`): when the server rejects a submission (wrong HSN code, duplicate selling unit, invalid payment amount, weak password) every typed value stays, the error appears on the field, and the corrected form saves. Selling by the stock unit locks the pack size to 1.

- **Cash on delivery** (`h-cash-collections.spec.ts`, worker on a phone viewport): the worker sees order total, already paid and due now; an amount above what is due is refused with the typed value kept; ₹100 cash is saved with a receipt and the remaining balance; My cash shows ₹100 to hand over; another worker gets a 404 for that delivery; Cash Collections shows ₹100 collected and pending for Ravi; the payment is listed once as collected on delivery; the owner receives ₹60, sees the ₹40 shortfall before confirming, and ₹40 stays pending.

- **Admin sign-in** (`g-admin-login.spec.ts`): an administrator signs in at `/admin/login` (reached from the normal sign-in page) and lands in the console; signed-out visitors to admin pages are sent there and returned to the page they wanted; a business account is refused and not left signed in; a wrong password is refused.

Reports: `playwright-report/index.html`; traces and screenshots of failures in `test-results/`.

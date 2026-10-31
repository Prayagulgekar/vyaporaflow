# Delivery cash collections and handovers

Added on 2026-10-29 by migration `supabase/migrations/20261029000100_delivery_cash_collections.sql`.

## The problem it fixes

Before this change the app had no way to record money taken on a delivery:

- The delivery screen's "Delivered" form only had a free-text **Note**, with the hint "Payments are recorded by the office. Note any cash collected here." (`src/app/d/[id]/page.tsx`). The number typed there was text in `deliveries.notes` and `delivery_events.note`. It was never a payment.
- `app.update_delivery` (migration 0500) changes stock and statuses only. It never creates a payment, so marking delivered never reduced what a shop owes. That part was correct and is kept.
- Payments could only be recorded by office staff (`app.record_payment` requires `owner`, `manager` or `staff`). Delivery workers had no access to payments at all.
- Nothing recorded which worker was holding which cash, or when they handed it over.

## Where each number comes from

| Value | Source of truth |
|---|---|
| Order total | `orders.grand_total` (lines priced by `app.place_order`). For a partial delivery, the delivered value, computed exactly as `app.generate_invoice` does. |
| What a shop owes (retailer outstanding) | Unchanged: `retailer_balances` view = issued invoices − credit notes − posted payments. The ledger's AR account must agree (`app.reconcile_receivables`). |
| Payments received from shops | Unchanged: `payments` (+ `payment_allocations`, `payment_reversals`). A delivery collection **is** a row here, recorded once. |
| Cash collected by a worker | New: `delivery_collections` (one row per collection, linked to company, retailer, order, delivery, worker, payment, method and time). |
| Cash handed over to the business | New: `cash_handovers` and `cash_handover_items`. |

The four amounts are separate and are never added together:

- **Retailer balance due**: invoices − credits − payments (per shop, on the Balances page; per order, on Cash Collections).
- **Cash collected**: sum of the worker's recorded cash collections.
- **Cash handed over**: sum of confirmed handovers.
- **Cash pending handover**: cash collected − cash handed over. Shown as "Cash with workers now".

## How a collection works

1. The worker opens the delivery on their phone. Before they finish, the form shows **Order total**, **Already paid** and **Due now** (from `app.order_position`).
2. They enter the amount actually received (0 is allowed), cash or UPI, and optionally a time and a note. A live line shows what the shop will still owe.
3. **Delivered in full and save payment** calls `app.complete_delivery`, which marks the delivery delivered **and** records the collection in one database transaction. If the amount is refused, the delivery is not marked delivered either.
4. `app.record_delivery_collection` checks, under row locks:
   - the delivery is assigned to this worker right now and is delivered;
   - the amount is 0 or more, in rupees and paise, and not more than what is due on that order (the live invoice's due amount if invoiced, otherwise the delivered value minus earlier collections);
   - the time is not in the future;
   - the idempotency key has not been used. A repeated submit (double tap, retry after a lost connection) returns the first record and creates nothing new.
5. If the amount is more than 0 it creates a normal receipt in `payments` (`RCPT-…`, recorded by the worker, note "Collected on delivery of order …") and posts it to the ledger. If the order already has an invoice, the payment is applied to that invoice. If not, the payment stays unapplied, exactly like an advance recorded by the office, and is applied automatically to that order's invoice when the invoice is issued (trigger `invoices_apply_collections`).
6. It always creates a `delivery_collections` row (`COL-…`), a delivery history line, an order history line and an audit log entry. With 0 collected there is no payment at all.

The worker then sees a confirmation with the receipt number and the reference. Deliveries that were already marked delivered before this update (or where the worker forgot) can get a collection afterwards from the same page ("Record the payment for this delivery").

UPI taken on delivery goes straight to the business account, so it never waits for a cash handover. Cheques and bank transfers are still recorded by the office on the Payments page.

## How a handover works

Owners and managers open **Cash Collections → Receive cash from a worker**, choose the person, tick the collections being settled (all are ticked by default), count the cash and enter what they actually received.

`app.confirm_cash_handover`:

- refuses delivery workers, office staff without manager rights, other companies, and anyone confirming cash they collected themselves;
- locks the worker's cash (one handover at a time per worker) and the chosen collections, recomputes the expected amount, and refuses if it differs from what the screen showed ("Reload the page");
- refuses more than expected, and refuses collections that are no longer pending (so the same cash cannot be handed over twice, even by two people at once);
- applies the cash received to the chosen collections oldest first. If ₹250 arrives for ₹300 expected, the oldest collections are covered first, **₹50 stays pending** on the remaining one, and the handover records `discrepancy = 50`;
- writes `HO-…`, who received it and when, a journal entry and an audit log entry, and notifies the worker.

A handover entered by mistake can be reversed on its page (owners and managers, with a reason). The record stays and is marked reversed, and its cash shows as pending again.

A handover never touches `payments` or a shop's balance. The shop's balance changed once, when the payment was collected.

## Ledger mapping

One account is added, `CASH_IN_TRANSIT` (cash held by delivery staff). Its balance always equals the total cash pending handover.

| Event | Debit | Credit |
|---|---|---|
| Cash collected on delivery | CASH_IN_TRANSIT | AR (retailer) |
| UPI collected on delivery | UPI | AR (retailer) |
| Cash handover confirmed | CASH | CASH_IN_TRANSIT |
| Handover reversed | CASH_IN_TRANSIT | CASH |
| Collection payment reversed | AR (retailer) | CASH_IN_TRANSIT (or UPI) |
| Payment recorded by the office (unchanged) | CASH / BANK / UPI / CHEQUE / OTHER | AR (retailer) |

`app.reverse_payment` is extended (same rules as before) so that reversing a delivery collection credits CASH_IN_TRANSIT, marks the collection reversed, and is refused once any of that cash has been handed over (reverse the handover first).

## Security

- New tables have Row-Level Security. A worker can read only their own collections and handovers; office staff of the wholesaler can read their company's. Retailers and other companies see none of it.
- Nobody can insert, update or delete these tables directly. Every change goes through the functions above, which check the signed-in user again. Collections and handovers are append-only apart from the one allowed status change to "reversed".
- Amounts sent by the browser are only requests. The database recomputes what is due and what is pending.

## Screens

| Who | Where | What |
|---|---|---|
| Delivery worker | `/d/<delivery>` | Due now, amount collected, cash or UPI, receipt after saving, payments on this delivery |
| Delivery worker | `/d/cash` (**My cash**) | Cash still to hand over, collections, confirmed handovers |
| Office | `/w/cash-collections` (**Cash Collections** in the menu) | Totals and per-worker table for a date range; filters for person, dates, retailer, order and status; list of collections |
| Office | `/w/cash-collections/<id>` | One collection: who, when, receipt, handovers, what the shop still owes on the order |
| Owner, manager | `/w/cash-collections/handover` | Receive cash, preview of any shortfall, handover history |
| Owner, manager | `/w/cash-collections/handovers/<id>` | Handover details and reversal |
| Office | `/w/payments` | Collections appear once, labelled "Collected on delivery by …" |

## Payments recorded by the office before this update

An unapplied payment recorded on the Payments page is an **advance**: `record_payment` applies money only to invoices that are open at the moment it is recorded, and the Payments page shows the rest as "Not yet applied". It counts as received, so it lowers the shop's balance. If the shop has no invoices yet, the balance goes below zero. That is a correct credit in the shop's favour. It is not an error.

This update never links such a payment to a delivery and never changes it. Cash Collections shows a warning when a shop with delivery collections also has unapplied office payments, so you can check whether the same cash was recorded twice.

Read-only checks for the Supabase SQL editor are in [`docs/sql/check-manual-payments.sql`](sql/check-manual-payments.sql).

import { paise, rupees, type Decimalish } from "@/domain/money";

/**
 * Delivery cash rules, mirrored from app.record_delivery_collection and
 * app.confirm_cash_handover for previews and tests. The database is authoritative.
 *
 * Four separate values, never mixed:
 *   retailer balance due  = order (or invoice) value - credits - payments   (what the shop still owes)
 *   cash collected        = sum of the worker's cash collections            (money taken from shops)
 *   cash handed over      = sum of confirmed handovers                      (money given to the office)
 *   cash pending handover = cash collected - cash handed over               (money still with the worker)
 */

export type CollectionCheck = { ok: true; remaining: string } | { ok: false; error: string };

/** Validate an amount a worker wants to record against what is due on the order. */
export function checkCollection(balanceDue: Decimalish, collecting: string): CollectionCheck {
  const text = collecting.trim();
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) return { ok: false, error: "Enter an amount like 100 or 100.50 (0 if nothing was collected)" };
  const due = paise(balanceDue) > 0n ? paise(balanceDue) : 0n;
  const amount = paise(text);
  if (amount > due) return { ok: false, error: `Only ${rupees(due)} is due on this order` };
  return { ok: true, remaining: rupees(due - amount) };
}

export interface PendingCollection {
  id: string;
  collectedAt: string | Date;
  pending: Decimalish;
}

/**
 * Apply cash received to pending collections, oldest first. Whatever is not
 * covered stays pending; the shortfall is the discrepancy.
 */
export function planHandover(collections: PendingCollection[], received: Decimalish) {
  const sorted = [...collections].sort((a, b) => {
    const t = new Date(a.collectedAt).getTime() - new Date(b.collectedAt).getTime();
    return t !== 0 ? t : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const expected = sorted.reduce((s, c) => s + paise(c.pending), 0n);
  const got = paise(received);
  if (got <= 0n) throw new RangeError("Cash received must be more than zero");
  if (got > expected) throw new RangeError("Cash received cannot be more than expected");
  let left = got;
  const items: { id: string; amount: string; stillPending: string }[] = [];
  for (const c of sorted) {
    const pending = paise(c.pending);
    const take = left < pending ? left : pending;
    left -= take;
    items.push({ id: c.id, amount: rupees(take), stillPending: rupees(pending - take) });
  }
  return { expected: rupees(expected), received: rupees(got), discrepancy: rupees(expected - got), items };
}

export const HANDOVER_STATUS_LABEL: Record<string, string> = {
  pending: "Pending handover",
  partially_handed_over: "Partly handed over",
  handed_over: "Handed over",
  not_required: "Paid by UPI (no cash)",
  no_payment: "Nothing collected",
  reversed: "Reversed",
};

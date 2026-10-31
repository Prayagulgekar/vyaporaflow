import { paise, rupees, type Decimalish } from "./money";

/**
 * Receivables arithmetic. Mirrors the invoice_balances / retailer_balances
 * views and app._allocate() limits.
 */
export interface InvoiceForAllocation {
  id: string;
  dueDate: string; // YYYY-MM-DD
  invoiceDate: string;
  number: string;
  due: Decimalish;
}

/** Oldest-due-first allocation plan (what app.record_payment does when allocations are omitted). */
export function planFifoAllocation(amount: Decimalish, invoices: InvoiceForAllocation[]): { invoiceId: string; amount: string }[] {
  let remaining = paise(amount);
  if (remaining <= 0n) throw new RangeError("Payment amount must be positive");
  const sorted = [...invoices].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.invoiceDate.localeCompare(b.invoiceDate) || a.number.localeCompare(b.number),
  );
  const plan: { invoiceId: string; amount: string }[] = [];
  for (const inv of sorted) {
    if (remaining <= 0n) break;
    const due = paise(inv.due);
    if (due <= 0n) continue;
    const take = due < remaining ? due : remaining;
    plan.push({ invoiceId: inv.id, amount: rupees(take) });
    remaining -= take;
  }
  return plan;
}

export function invoiceDue(grandTotal: Decimalish, credited: Decimalish, allocated: Decimalish): string {
  return rupees(paise(grandTotal) - paise(credited) - paise(allocated));
}

export type InvoicePaymentStatus = "void" | "paid" | "overdue" | "partially_paid" | "unpaid";

export function invoicePaymentStatus(args: {
  void: boolean;
  due: Decimalish;
  paidOrCredited: Decimalish;
  dueDate: string;
  today: string;
}): InvoicePaymentStatus {
  if (args.void) return "void";
  if (paise(args.due) <= 0n) return "paid";
  if (args.dueDate < args.today) return "overdue";
  if (paise(args.paidOrCredited) > 0n) return "partially_paid";
  return "unpaid";
}

/** Outstanding = invoiced - credit notes - posted payments (advances reduce it). */
export function outstandingBalance(invoiced: Decimalish, credited: Decimalish, received: Decimalish): string {
  return rupees(paise(invoiced) - paise(credited) - paise(received));
}

export function validateAllocation(args: { amount: Decimalish; unapplied: Decimalish; invoiceDue: Decimalish }): string | null {
  const a = paise(args.amount);
  if (a <= 0n) return "Allocation amount must be positive";
  if (a > paise(args.unapplied)) return "Allocation exceeds the unapplied amount of the payment";
  if (a > paise(args.invoiceDue)) return "Allocation exceeds the amount due on the invoice";
  return null;
}

export interface AgingBuckets {
  current: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d90_plus: string;
}

export function agingBuckets(items: { due: Decimalish; daysOverdue: number }[]): AgingBuckets {
  const b = { current: 0n, d1_30: 0n, d31_60: 0n, d61_90: 0n, d90_plus: 0n };
  for (const it of items) {
    const v = paise(it.due);
    if (v <= 0n) continue;
    if (it.daysOverdue <= 0) b.current += v;
    else if (it.daysOverdue <= 30) b.d1_30 += v;
    else if (it.daysOverdue <= 60) b.d31_60 += v;
    else if (it.daysOverdue <= 90) b.d61_90 += v;
    else b.d90_plus += v;
  }
  return { current: rupees(b.current), d1_30: rupees(b.d1_30), d31_60: rupees(b.d31_60), d61_90: rupees(b.d61_90), d90_plus: rupees(b.d90_plus) };
}

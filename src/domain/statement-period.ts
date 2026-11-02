/**
 * Period view of a customer statement. Works on the lines produced by
 * getStatement() (src/server/billing.ts), which already carry the running
 * balance; this only selects a date range. The opening balance is the running
 * balance of the last line before the period and the closing balance is the
 * running balance of the last line in it, so the figures always agree with
 * the full statement.
 */
import { paise, rupees } from "./money";

export interface PeriodLine {
  date: string; // YYYY-MM-DD (India)
  debit: string;
  credit: string;
  balance: string;
}

export interface StatementPeriod<L extends PeriodLine> {
  from: string | null;
  to: string | null;
  opening: string;
  lines: L[];
  debit: string;
  credit: string;
  closing: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string | null | undefined): s is string {
  if (!s || !ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function slicePeriod<L extends PeriodLine>(all: L[], from: string | null, to: string | null): StatementPeriod<L> {
  let opening = 0n;
  const lines: L[] = [];
  for (const l of all) {
    if (from && l.date < from) opening = paise(l.balance);
    else if (!to || l.date <= to) lines.push(l);
  }
  let debit = 0n;
  let credit = 0n;
  for (const l of lines) {
    debit += paise(l.debit);
    credit += paise(l.credit);
  }
  const last = lines[lines.length - 1];
  return { from, to, opening: rupees(opening), lines, debit: rupees(debit), credit: rupees(credit), closing: last ? last.balance : rupees(opening) };
}

/** First and last day of a calendar month given as YYYY-MM. */
export function monthRange(month: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12 || y < 2000 || y > 2100) return null;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}` };
}

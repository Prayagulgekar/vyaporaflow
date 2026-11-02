import "server-only";
/**
 * PDF documents: balance due statement, account statement (full, date range
 * or month), GST tax invoice and payment receipt.
 *
 * Every figure comes from the existing billing functions, read as the signed-in
 * user so RLS applies: getStatement() for statement lines and running balances,
 * the retailer_balances view for account totals, invoice_balances for what is
 * due on each invoice, getInvoice() for the stored invoice values and
 * getPayment() for receipts. Nothing is recalculated a second way.
 */
import { addMoney, compareMoney, formatINR, subMoney } from "@/domain/money";
import { isIsoDate, monthRange, slicePeriod, type StatementPeriod } from "@/domain/statement-period";
import { formatDate, formatDateTime, formatQuantity, todayIST } from "@/lib/format";
import { getInvoice, getPayment, getStatement, openInvoices, type InvoiceDetail, type StatementLine } from "@/server/billing";
import { AppError } from "@/server/errors";
import { methodLabel } from "@/features/shared/whatsapp-options";
import { userTx } from "@/server/rpc";
import { uuid } from "@/server/validation";
import { COLORS, fileSlug, PdfLayout, type HeaderInfo } from "@/server/pdf/layout";

export interface PartyDetails {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  pincode: string | null;
  state_code: string | null;
  state_name: string | null;
}

async function loadParties(userId: string, ids: string[]): Promise<Map<string, PartyDetails>> {
  const rows = await userTx(userId, (q) =>
    q.query<PartyDetails>(
      `select c.id, c.name, c.contact_name, c.phone, c.email, c.gstin, a.line1, a.line2, a.city, a.pincode, a.state_code, s.name as state_name
         from public.companies c
         left join public.business_addresses a on a.company_id = c.id and a.is_primary
         left join public.indian_states s on s.code = a.state_code
        where c.id = any($1::uuid[])`,
      [ids],
    ),
  );
  return new Map(rows.map((r) => [r.id, r]));
}

/** Contact details of one business (name, contact person, phone, GSTIN, address), read through RLS. */
export async function loadParty(userId: string, companyId: string): Promise<PartyDetails | null> {
  if (!uuid.safeParse(companyId).success) return null;
  return (await loadParties(userId, [companyId])).get(companyId) ?? null;
}

function addressLines(p: PartyDetails | undefined): string[] {
  if (!p) return [];
  const out: string[] = [];
  if (p.line1) out.push([p.line1, p.line2].filter(Boolean).join(", "));
  const place = [p.city, p.pincode].filter(Boolean).join(" ");
  if (place || p.state_name) out.push([place, p.state_name ? `${p.state_name}${p.state_code ? ` (${p.state_code})` : ""}` : null].filter(Boolean).join(", "));
  return out;
}

function issuerLines(p: PartyDetails | undefined): string[] {
  if (!p) return [];
  return [
    ...addressLines(p),
    `GSTIN: ${p.gstin ?? "Not registered"}`,
    [p.phone ? `Phone ${p.phone}` : null, p.email].filter(Boolean).join(" · "),
  ].filter(Boolean);
}

function customerLines(p: PartyDetails | undefined): string[] {
  if (!p) return [];
  return [
    p.contact_name ? `Contact: ${p.contact_name}` : null,
    ...addressLines(p),
    p.phone ? `Phone: ${p.phone}` : null,
    `GSTIN: ${p.gstin ?? "Unregistered"}`,
  ].filter((x): x is string => Boolean(x));
}

const inr = (v: string | number) => formatINR(v);
/** "-₹250.00" for a deduction, plain "₹0.00" when there is none. */
const minus = (v: string) => (compareMoney(v, 0) === 0 ? inr(v) : `-${inr(v)}`);
const NOT_INVOICE = "This is an account statement, not a GST tax invoice. Tax invoices are issued separately for each delivery.";

export interface PdfFile {
  bytes: Uint8Array;
  filename: string;
}

// ---------------------------------------------------------------------------
// Balance due
// ---------------------------------------------------------------------------

export interface BalanceDueModel {
  wholesaler: PartyDetails;
  retailer: PartyDetails;
  asOf: string;
  invoiced: string;
  credited: string;
  received: string;
  outstanding: string;
  unapplied: string;
  overdue: string;
  oldestDueDate: string | null;
  openInvoices: { invoice_number: string; invoice_date: string; due_date: string; grand_total: string; due: string; payment_status: string }[];
  /** Running balance of the full statement; equals `outstanding` when the books agree. */
  statementBalance: string;
}

export async function loadBalanceDue(userId: string, wholesalerId: string, retailerId: string): Promise<BalanceDueModel> {
  if (!uuid.safeParse(retailerId).success) throw new AppError("not_found", "Customer not found");
  const [rb] = await userTx(userId, (q) =>
    q.query<{ invoiced: string; credited: string; received: string; outstanding: string; unapplied: string }>(
      "select invoiced, credited, received, outstanding, unapplied from public.retailer_balances where wholesaler_id = $1 and retailer_id = $2",
      [wholesalerId, retailerId],
    ),
  );
  if (!rb) throw new AppError("not_found", "Customer not found");
  const [statement, open, parties] = await Promise.all([
    getStatement(userId, wholesalerId, retailerId),
    openInvoices(userId, wholesalerId, retailerId),
    loadParties(userId, [wholesalerId, retailerId]),
  ]);
  const overdueRows = open.filter((i) => i.payment_status === "overdue");
  return {
    wholesaler: parties.get(wholesalerId)!,
    retailer: parties.get(retailerId)!,
    asOf: todayIST(),
    ...rb,
    overdue: addMoney("0", ...overdueRows.map((i) => i.due)),
    oldestDueDate: open.length ? open.map((i) => i.due_date).sort()[0]! : null,
    openInvoices: open,
    statementBalance: statement.totals.balance,
  };
}

const STATUS_LABEL: Record<string, string> = { overdue: "Overdue", unpaid: "Unpaid", partially_paid: "Part paid", paid: "Paid", void: "Void" };

export async function renderBalanceDue(m: BalanceDueModel): Promise<PdfFile> {
  const header: HeaderInfo = {
    title: "Balance due statement",
    subtitle: "Account summary · not a tax invoice",
    issuer: m.wholesaler.name,
    issuerLines: issuerLines(m.wholesaler),
    meta: [
      ["Statement date", formatDate(m.asOf)],
      ["Customer", m.retailer.name],
    ],
    shortRef: m.retailer.name,
  };
  const pdf = await PdfLayout.create(header, { footerNote: NOT_INVOICE, author: m.wholesaler.name, subject: `Balance due for ${m.retailer.name}` });
  pdf.parties([
    { label: "Customer", strong: m.retailer.name, lines: customerLines(m.retailer) },
    {
      label: "Summary",
      strong: compareMoney(m.outstanding, 0) > 0 ? `${inr(m.outstanding)} due` : compareMoney(m.outstanding, 0) < 0 ? `${inr(subMoney(0, m.outstanding))} in credit` : "Nothing due",
      lines: [
        `As on ${formatDate(m.asOf)}`,
        `Open invoices: ${m.openInvoices.length}`,
        m.oldestDueDate ? `Oldest due date: ${formatDate(m.oldestDueDate)}` : "",
        compareMoney(m.overdue, 0) > 0 ? `Overdue: ${inr(m.overdue)}` : "Nothing overdue",
      ].filter(Boolean),
    },
  ]);
  pdf.tiles([
    { label: "Total invoiced", value: inr(m.invoiced) },
    { label: "Credit notes", value: inr(m.credited) },
    { label: "Payments received", value: inr(m.received) },
    { label: "Outstanding balance", value: inr(m.outstanding), highlight: true },
  ]);
  const extra = [
    compareMoney(m.overdue, 0) > 0 ? { label: "Overdue amount", value: inr(m.overdue), tone: "danger" as const } : null,
    compareMoney(m.unapplied, 0) > 0 ? { label: "Advance not yet applied", value: inr(m.unapplied) } : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null);
  if (extra.length) pdf.tiles(extra);

  pdf.heading("Open invoices");
  pdf.table(
    [
      { header: "Invoice", width: 2.2 },
      { header: "Invoice date", width: 1.6 },
      { header: "Due date", width: 1.6 },
      { header: "Status", width: 1.3 },
      { header: "Invoice total", width: 1.7, align: "right" },
      { header: "Amount due", width: 1.7, align: "right" },
    ],
    m.openInvoices.map((i) => ({
      cells: [i.invoice_number, formatDate(i.invoice_date), formatDate(i.due_date), STATUS_LABEL[i.payment_status] ?? i.payment_status, inr(i.grand_total), inr(i.due)],
      color: i.payment_status === "overdue" ? COLORS.danger : undefined,
    })),
    { empty: "No open invoices." },
  );
  const dueTotal = addMoney("0", ...m.openInvoices.map((i) => i.due));
  const reconciles = compareMoney(subMoney(dueTotal, m.unapplied), m.outstanding) === 0;
  pdf.totals([
    ...(m.openInvoices.length ? [{ label: "Due on open invoices", value: inr(dueTotal) }] : []),
    ...(reconciles && compareMoney(m.unapplied, 0) > 0 ? [{ label: "Less advance not yet applied", value: minus(m.unapplied) }] : []),
    { label: "Outstanding balance", value: inr(m.outstanding), bold: true, rule: true },
  ]);
  pdf.gap(6);
  pdf.note(
    `Outstanding balance = total invoiced − credit notes − payments received. A positive balance is the amount payable to ${m.wholesaler.name}; a negative balance is a credit in the customer's favour. Overdue means past the invoice due date. ${NOT_INVOICE}`,
  );
  return { bytes: await pdf.finish(), filename: `Balance-Due-${fileSlug(m.retailer.name)}-${m.asOf}.pdf` };
}

// ---------------------------------------------------------------------------
// Account statement (full history, a date range or a month)
// ---------------------------------------------------------------------------

export interface StatementModel {
  wholesaler: PartyDetails;
  retailer: PartyDetails;
  generatedOn: string;
  monthly: boolean;
  period: StatementPeriod<StatementLine>;
}

/** Resolves ?month=YYYY-MM or ?from=&to= (either may be blank). Invalid input is a validation error. */
export function resolveStatementPeriod(sp: { month?: string | null; from?: string | null; to?: string | null }): { from: string | null; to: string | null; monthly: boolean } {
  if (sp.month) {
    const r = monthRange(sp.month);
    if (!r) throw new AppError("validation", "Choose a valid month");
    return { ...r, monthly: true };
  }
  const from = sp.from || null;
  const to = sp.to || null;
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) throw new AppError("validation", "Dates must be valid (YYYY-MM-DD)");
  if (from && to && from > to) throw new AppError("validation", "The start date must be on or before the end date");
  return { from, to, monthly: false };
}

export async function loadStatement(userId: string, wholesalerId: string, retailerId: string, range: { from: string | null; to: string | null; monthly?: boolean }): Promise<StatementModel> {
  if (!uuid.safeParse(retailerId).success || !uuid.safeParse(wholesalerId).success) throw new AppError("not_found", "Customer not found");
  const [statement, parties] = await Promise.all([getStatement(userId, wholesalerId, retailerId), loadParties(userId, [wholesalerId, retailerId])]);
  return {
    wholesaler: parties.get(wholesalerId)!,
    retailer: parties.get(retailerId)!,
    generatedOn: todayIST(),
    monthly: Boolean(range.monthly),
    period: slicePeriod(statement.lines, range.from, range.to),
  };
}

const KIND_LABEL: Record<StatementLine["kind"], string> = {
  invoice: "Invoice",
  credit_note: "Credit note",
  payment: "Payment",
  payment_reversal: "Payment reversal",
  invoice_void: "Invoice void",
};

export function periodLabel(p: { from: string | null; to: string | null }): string {
  if (p.from && p.to) return `${formatDate(p.from)} to ${formatDate(p.to)}`;
  if (p.from) return `From ${formatDate(p.from)}`;
  if (p.to) return `Up to ${formatDate(p.to)}`;
  return "All transactions";
}

export async function renderStatement(m: StatementModel): Promise<PdfFile> {
  const p = m.period;
  const title = m.monthly ? "Monthly account statement" : "Account statement";
  const pdf = await PdfLayout.create(
    {
      title,
      subtitle: "Customer ledger · not a tax invoice",
      issuer: m.wholesaler.name,
      issuerLines: issuerLines(m.wholesaler),
      meta: [
        ["Period", periodLabel(p)],
        ["Generated", formatDate(m.generatedOn)],
      ],
      shortRef: m.retailer.name,
    },
    { footerNote: NOT_INVOICE, author: m.wholesaler.name, subject: `${title} for ${m.retailer.name}` },
  );
  pdf.parties([
    { label: "Customer", strong: m.retailer.name, lines: customerLines(m.retailer) },
    { label: "Statement period", strong: periodLabel(p), lines: [`Transactions: ${p.lines.length}`, `Generated on ${formatDate(m.generatedOn)}`] },
  ]);
  pdf.tiles([
    { label: "Opening balance", value: inr(p.opening) },
    { label: "Debits (invoices, reversals)", value: inr(p.debit) },
    { label: "Credits (payments, credit notes)", value: inr(p.credit) },
    { label: "Closing balance", value: inr(p.closing), highlight: true },
  ]);
  pdf.heading("Transactions");
  const rows = [
    { cells: [p.from ? formatDate(p.from) : "", "", "", "Opening balance", "", "", inr(p.opening)], shade: true, bold: true },
    ...p.lines.map((l) => ({
      cells: [formatDate(l.date), KIND_LABEL[l.kind], l.reference, l.description, compareMoney(l.debit, 0) ? inr(l.debit) : "", compareMoney(l.credit, 0) ? inr(l.credit) : "", inr(l.balance)],
    })),
    { cells: [p.to ? formatDate(p.to) : "", "", "", "Closing balance", inr(p.debit), inr(p.credit), inr(p.closing)], shade: true, bold: true },
  ];
  pdf.table(
    [
      { header: "Date", width: 1.45 },
      { header: "Type", width: 1.35 },
      { header: "Reference", width: 1.7 },
      { header: "Details", width: 2.7 },
      { header: "Debit", width: 1.35, align: "right" },
      { header: "Credit", width: 1.35, align: "right" },
      { header: "Balance", width: 1.45, align: "right" },
    ],
    p.lines.length ? rows : [rows[0]!, { cells: ["", "", "", "No transactions in this period.", "", "", ""] }, rows[rows.length - 1]!],
    { size: 7.9 },
  );
  pdf.note(
    `Balance = opening balance + debits − credits, carried line by line. A positive balance is the amount payable to ${m.wholesaler.name}; a negative balance is a credit in the customer's favour. ${NOT_INVOICE}`,
  );
  const span = p.from && p.to ? `${p.from}-to-${p.to}` : p.to ? `up-to-${p.to}` : p.from ? `from-${p.from}` : `as-of-${m.generatedOn}`;
  return { bytes: await pdf.finish(), filename: `${m.monthly ? "Monthly-Statement" : "Account-Statement"}-${fileSlug(m.retailer.name)}-${span}.pdf` };
}

// ---------------------------------------------------------------------------
// GST tax invoice (the same stored values as the on-screen invoice)
// ---------------------------------------------------------------------------

export async function renderInvoice(inv: InvoiceDetail): Promise<PdfFile> {
  const inter = inv.supply_type === "inter_state";
  const s = inv.seller;
  const b = inv.buyer;
  const pdf = await PdfLayout.create(
    {
      title: inv.status === "void" ? "Tax invoice (void)" : "Tax invoice",
      subtitle: inter ? "Inter-state supply · IGST" : "Intra-state supply · CGST + SGST",
      issuer: s.name,
      issuerLines: [
        [s.line1, s.line2].filter(Boolean).join(", "),
        `${s.city} ${s.pincode}, ${s.state_name} (${s.state_code})`,
        `GSTIN: ${s.gstin ?? "Not registered"}`,
        s.phone ? `Phone ${s.phone}` : "",
      ].filter(Boolean),
      meta: [
        ["Invoice no.", inv.invoice_number],
        ["Invoice date", formatDate(inv.invoice_date)],
        ["Due date", formatDate(inv.due_date)],
        ["Order", inv.order_number],
      ],
      shortRef: inv.invoice_number,
      watermark: inv.status === "void" ? "VOID" : undefined,
    },
    {
      footerNote: "Computer-generated invoice from VyaporaFlow. This is not an e-invoice (no IRN). Tax rates and HSN codes are as entered by the seller.",
      author: s.name,
      subject: `Tax invoice ${inv.invoice_number}`,
    },
  );
  if (inv.status === "void") pdf.note(`This invoice has been voided${inv.void_reason ? `: ${inv.void_reason}` : ""}. It is kept for the record and is not payable.`, "warn");
  pdf.parties([
    { label: "Bill to", strong: b.name, lines: [[b.line1, b.line2].filter(Boolean).join(", "), `${b.city} ${b.pincode}`, `${b.state_name} (${b.state_code})`, `GSTIN: ${b.gstin ?? "Unregistered"}`] },
    { label: "Place of supply", strong: `${inv.place_of_supply_name} (${inv.place_of_supply})`, lines: [inter ? "Inter-state supply: IGST" : "Intra-state supply: CGST + SGST", `Order ${inv.order_number}`] },
  ]);
  const taxCols = inter
    ? [{ header: "IGST", width: 1.25, align: "right" as const }]
    : [
        { header: "CGST", width: 1.15, align: "right" as const },
        { header: "SGST", width: 1.15, align: "right" as const },
      ];
  pdf.table(
    [
      { header: "#", width: 0.45 },
      { header: "Description", width: 3.1 },
      { header: "HSN", width: 0.95 },
      { header: "Qty", width: 1.15, align: "right" },
      { header: "Rate", width: 1.2, align: "right" },
      { header: "Taxable", width: 1.35, align: "right" },
      { header: "GST %", width: 0.75, align: "right" },
      ...taxCols,
      { header: "Total", width: 1.35, align: "right" },
    ],
    inv.items.map((i) => ({
      cells: [
        String(i.line_no),
        i.description,
        i.hsn_code ?? "–",
        formatQuantity(i.quantity, i.unit_code),
        inr(i.unit_price),
        inr(i.taxable_amount),
        String(Number(i.tax_rate)),
        ...(inter ? [inr(i.igst_amount)] : [inr(i.cgst_amount), inr(i.sgst_amount)]),
        inr(i.line_total),
      ],
    })),
    { size: 7.8 },
  );
  pdf.totals([
    { label: "Taxable value", value: inr(inv.taxable_total) },
    ...(inter ? [{ label: "IGST", value: inr(inv.igst_total) }] : [{ label: "CGST", value: inr(inv.cgst_total) }, { label: "SGST", value: inr(inv.sgst_total) }]),
    { label: "Delivery charge", value: inr(inv.delivery_charge) },
    { label: "Invoice total", value: inr(inv.grand_total), bold: true, rule: true },
  ]);
  if (inv.status === "issued") {
    pdf.heading(`Payment status on ${formatDate(todayIST())}`);
    pdf.totals(
      [
        { label: "Invoice total", value: inr(inv.grand_total) },
        { label: "Credit notes", value: minus(inv.credited) },
        { label: "Paid", value: minus(inv.paid) },
        { label: "Amount due", value: inr(inv.due), bold: true, rule: true },
      ],
    );
  }
  return { bytes: await pdf.finish(), filename: `Tax-Invoice-${fileSlug(inv.invoice_number)}.pdf` };
}

export async function loadInvoicePdf(userId: string, invoiceId: string): Promise<{ inv: InvoiceDetail; file: PdfFile }> {
  const inv = await getInvoice(userId, invoiceId);
  return { inv, file: await renderInvoice(inv) };
}

// ---------------------------------------------------------------------------
// Payment receipt
// ---------------------------------------------------------------------------

export type PaymentDetail = Awaited<ReturnType<typeof getPayment>>;

export interface ReceiptModel {
  payment: PaymentDetail;
  wholesaler: PartyDetails;
  retailer: PartyDetails;
}

export async function loadReceipt(userId: string, paymentId: string): Promise<ReceiptModel> {
  const payment = await getPayment(userId, paymentId);
  const parties = await loadParties(userId, [payment.wholesaler_id, payment.retailer_id]);
  return { payment, wholesaler: parties.get(payment.wholesaler_id)!, retailer: parties.get(payment.retailer_id)! };
}

export async function renderReceipt(m: ReceiptModel): Promise<PdfFile> {
  const p = m.payment;
  const reversed = p.status === "reversed";
  const pdf = await PdfLayout.create(
    {
      title: "Payment receipt",
      subtitle: "Acknowledgement of payment · not a tax invoice",
      issuer: m.wholesaler.name,
      issuerLines: issuerLines(m.wholesaler),
      meta: [
        ["Receipt no.", p.payment_number],
        ["Date received", formatDate(new Date(p.received_at))],
        ["Status", reversed ? "Reversed" : "Received"],
      ],
      shortRef: p.payment_number,
      watermark: reversed ? "REVERSED" : undefined,
    },
    { footerNote: "Payment receipt generated from VyaporaFlow records. Payments are recorded by the business; no payment gateway is involved.", author: m.wholesaler.name, subject: `Payment receipt ${p.payment_number}` },
  );
  if (reversed) pdf.note(`This payment was reversed on ${p.reversal ? formatDateTime(p.reversal.reversed_at) : "a later date"}${p.reversal?.reason ? `: ${p.reversal.reason}` : ""}. It no longer counts towards the account.`, "warn");
  pdf.parties([
    { label: "Received from", strong: m.retailer.name, lines: customerLines(m.retailer) },
    {
      label: "Payment details",
      strong: inr(p.amount),
      lines: [
        `Method: ${methodLabel(p.method) ?? p.method}`,
        p.reference ? `Reference: ${p.reference}` : "",
        `Received: ${formatDateTime(new Date(p.received_at))}`,
        p.collection_id ? `Collected on delivery${p.collection_number ? ` (${p.collection_number})` : ""}${p.collected_by ? ` by ${p.collected_by}` : ""}` : p.recorded_by_name ? `Recorded by ${p.recorded_by_name}` : "",
      ].filter(Boolean),
    },
  ]);
  pdf.tiles([
    { label: "Amount received", value: inr(p.amount), highlight: !reversed },
    { label: "Applied to invoices", value: inr(p.allocated) },
    { label: "Not yet applied (advance)", value: inr(p.unapplied) },
  ]);
  pdf.heading("Applied to invoices");
  pdf.table(
    [
      { header: "Invoice", width: 2.4 },
      { header: "Applied on", width: 2 },
      { header: "Entry", width: 2 },
      { header: "Amount", width: 1.8, align: "right" },
    ],
    p.allocations.map((a) => ({ cells: [a.invoice_number, formatDate(new Date(a.created_at)), a.reversal ? "Reversal" : "Applied", inr(a.amount)] })),
    { empty: "This payment has not been applied to an invoice yet. It is held as an advance on the account." },
  );
  pdf.totals([
    { label: "Amount received", value: inr(p.amount) },
    { label: "Applied to invoices", value: inr(p.allocated) },
    { label: "Not yet applied (advance)", value: inr(p.unapplied), bold: true, rule: true },
  ]);
  if (p.notes) {
    pdf.heading("Notes");
    pdf.paragraph(p.notes);
  }
  return { bytes: await pdf.finish(), filename: `Payment-Receipt-${fileSlug(p.payment_number)}.pdf` };
}

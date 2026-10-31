import "server-only";
import { z } from "zod";
import { paise, rupees } from "@/domain/money";
import { AppError } from "@/server/errors";
import { callFn, clampPage, json, pageOf, userTx, type Page } from "@/server/rpc";
import { fieldErrors, optionalText, positiveMoney, uuid } from "@/server/validation";

export interface InvoiceListRow {
  invoice_id: string;
  invoice_number: string;
  wholesaler_id: string;
  retailer_id: string;
  order_id: string;
  order_number: string;
  counterparty: string;
  invoice_date: string;
  due_date: string;
  status: "issued" | "void";
  grand_total: string;
  credited: string;
  paid: string;
  due: string;
  payment_status: string;
  total_count: number;
}

export async function listInvoices(
  userId: string,
  side: "wholesaler" | "retailer",
  companyId: string,
  opts: { q?: string; status?: string; retailerId?: string; page?: unknown; pageSize?: number },
): Promise<Page<InvoiceListRow>> {
  const page = clampPage(opts.page);
  const size = opts.pageSize ?? 15;
  const status = ["unpaid", "partially_paid", "paid", "overdue", "void", "open"].includes(opts.status ?? "") ? opts.status : null;
  const other = side === "wholesaler" ? "retailer" : "wholesaler";
  const rows = await userTx(userId, (q) =>
    q.query<InvoiceListRow>(
      `select ib.invoice_id, ib.invoice_number, ib.wholesaler_id, ib.retailer_id, ib.order_id, o.order_number, c.name as counterparty,
              ib.invoice_date::text, ib.due_date::text, ib.status, ib.grand_total, ib.credited, ib.paid, ib.due, ib.payment_status,
              (count(*) over ())::int as total_count
         from public.invoice_balances ib
         join public.orders o on o.id = ib.order_id
         join public.companies c on c.id = ib.${other}_id
        where ib.${side}_id = $1
          and ($2::text is null or ib.invoice_number ilike '%' || $2 || '%' or c.name ilike '%' || $2 || '%' or o.order_number ilike '%' || $2 || '%')
          and ($3::text is null or ($3 = 'open' and ib.due > 0 and ib.status = 'issued') or ib.payment_status = $3)
          and ($4::uuid is null or ib.retailer_id = $4)
        order by ib.invoice_date desc, ib.invoice_number desc
        limit $5 offset $6`,
      [companyId, opts.q?.trim() || null, status, opts.retailerId || null, size, (page - 1) * size],
    ),
  );
  return pageOf(rows, page, size);
}

export interface InvoiceDetail {
  id: string;
  invoice_number: string;
  wholesaler_id: string;
  retailer_id: string;
  order_id: string;
  order_number: string;
  invoice_date: string;
  due_date: string;
  supply_type: "intra_state" | "inter_state";
  place_of_supply: string;
  place_of_supply_name: string;
  seller: { name: string; gstin: string | null; phone: string | null; line1: string; line2: string | null; city: string; state_code: string; state_name: string; pincode: string };
  buyer: InvoiceDetail["seller"] & { delivery_address?: { line1: string; city: string; pincode: string } };
  subtotal: string;
  discount_total: string;
  taxable_total: string;
  cgst_total: string;
  sgst_total: string;
  igst_total: string;
  tax_total: string;
  delivery_charge: string;
  grand_total: string;
  status: "issued" | "void";
  void_reason: string | null;
  credited: string;
  paid: string;
  due: string;
  payment_status: string;
  items: { line_no: number; description: string; hsn_code: string | null; quantity: string; unit_code: string; unit_price: string; discount_amount: string; taxable_amount: string; tax_rate: string; cgst_amount: string; sgst_amount: string; igst_amount: string; line_total: string }[];
  credit_notes: { id: string; credit_note_number: string; kind: string; reason: string; amount: string; issued_on: string }[];
  allocations: { payment_id: string; payment_number: string; amount: string; method: string; reference: string | null; received_at: string; reversal: boolean }[];
}

export async function getInvoice(userId: string, invoiceId: string): Promise<InvoiceDetail> {
  if (!uuid.safeParse(invoiceId).success) throw new AppError("not_found", "Invoice not found");
  const rows = await userTx(userId, (q) =>
    q.query<InvoiceDetail>(
      `select i.id, i.invoice_number, i.wholesaler_id, i.retailer_id, i.order_id, o.order_number, i.invoice_date::text, i.due_date::text,
              i.supply_type, i.place_of_supply, s.name as place_of_supply_name, i.seller, i.buyer,
              i.subtotal, i.discount_total, i.taxable_total, i.cgst_total, i.sgst_total, i.igst_total, i.tax_total, i.delivery_charge,
              i.grand_total, i.status, i.void_reason, ib.credited, ib.paid, ib.due, ib.payment_status,
              coalesce((select jsonb_agg(to_jsonb(ii) - 'id' - 'invoice_id' - 'order_item_id' order by ii.line_no) from public.invoice_items ii where ii.invoice_id = i.id), '[]') as items,
              coalesce((select jsonb_agg(jsonb_build_object('id', cn.id, 'credit_note_number', cn.credit_note_number, 'kind', cn.kind,
                   'reason', cn.reason, 'amount', cn.amount::text, 'issued_on', cn.issued_on) order by cn.created_at)
                 from public.credit_notes cn where cn.invoice_id = i.id), '[]') as credit_notes,
              coalesce((select jsonb_agg(jsonb_build_object('payment_id', p.id, 'payment_number', p.payment_number, 'amount', a.amount::text,
                   'method', p.method, 'reference', p.reference, 'received_at', p.received_at, 'reversal', a.reversal_of is not null) order by a.created_at)
                 from public.payment_allocations a join public.payments p on p.id = a.payment_id where a.invoice_id = i.id), '[]') as allocations
         from public.invoices i
         join public.invoice_balances ib on ib.invoice_id = i.id
         join public.orders o on o.id = i.order_id
         join public.indian_states s on s.code = i.place_of_supply
        where i.id = $1`,
      [invoiceId],
    ),
  );
  if (!rows[0]) throw new AppError("not_found", "Invoice not found");
  return rows[0];
}

export async function generateInvoice(userId: string, orderId: string, dueDays?: number | null): Promise<string> {
  uuid.parse(orderId);
  if (dueDays !== undefined && dueDays !== null && (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 180)) {
    throw new AppError("validation", "Payment terms must be 0-180 days");
  }
  return userTx(userId, (q) => callFn<string>(q, "generate_invoice", [orderId, dueDays ?? null]));
}

export async function voidInvoice(userId: string, invoiceId: string, reason: string) {
  uuid.parse(invoiceId);
  await userTx(userId, (q) => callFn(q, "void_invoice", [invoiceId, reason.trim()]));
}

const creditNoteSchema = z.object({
  invoice_id: uuid,
  amount: positiveMoney,
  kind: z.enum(["return", "discount", "correction"]),
  reason: z.string().trim().min(3, "Give a reason").max(500),
});

export async function createCreditNote(userId: string, input: unknown): Promise<string> {
  const r = creditNoteSchema.safeParse(input);
  if (!r.success) throw new AppError("validation", "Please correct the highlighted fields", fieldErrors(r.error));
  const d = r.data;
  return userTx(userId, (q) => callFn<string>(q, "create_credit_note", [d.invoice_id, d.amount, d.kind, d.reason]));
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
export interface PaymentRow {
  payment_id: string;
  payment_number: string;
  wholesaler_id: string;
  retailer_id: string;
  counterparty: string;
  amount: string;
  method: string;
  reference: string | null;
  received_at: Date;
  status: "posted" | "reversed";
  verified_by_gateway: boolean;
  allocated: string;
  unapplied: string;
  /** Set when a delivery worker collected this payment on a delivery. */
  collection_id: string | null;
  collected_by: string | null;
  total_count: number;
}

export async function listPayments(
  userId: string,
  side: "wholesaler" | "retailer",
  companyId: string,
  opts: { q?: string; method?: string; retailerId?: string; page?: unknown; pageSize?: number },
): Promise<Page<PaymentRow>> {
  const page = clampPage(opts.page);
  const size = opts.pageSize ?? 15;
  const other = side === "wholesaler" ? "retailer" : "wholesaler";
  const method = ["cash", "bank_transfer", "upi", "cheque", "other"].includes(opts.method ?? "") ? opts.method : null;
  const rows = await userTx(userId, (q) =>
    q.query<PaymentRow>(
      `select pb.payment_id, pb.payment_number, pb.wholesaler_id, pb.retailer_id, c.name as counterparty, pb.amount, pb.method,
              pb.reference, pb.received_at, pb.status, pb.verified_by_gateway, pb.allocated, pb.unapplied,
              dc.id as collection_id, wp.full_name as collected_by,
              (count(*) over ())::int as total_count
         from public.payment_balances pb join public.companies c on c.id = pb.${other}_id
         left join public.delivery_collections dc on dc.payment_id = pb.payment_id
         left join public.profiles wp on wp.id = dc.worker_id
        where pb.${side}_id = $1
          and ($2::text is null or pb.payment_number ilike '%' || $2 || '%' or c.name ilike '%' || $2 || '%' or pb.reference ilike '%' || $2 || '%')
          and ($3::text is null or pb.method::text = $3)
          and ($4::uuid is null or pb.retailer_id = $4)
        order by pb.received_at desc, pb.payment_number desc
        limit $5 offset $6`,
      [companyId, opts.q?.trim() || null, method, opts.retailerId || null, size, (page - 1) * size],
    ),
  );
  return pageOf(rows, page, size);
}

export async function getPayment(userId: string, paymentId: string) {
  if (!uuid.safeParse(paymentId).success) throw new AppError("not_found", "Payment not found");
  const rows = await userTx(userId, (q) =>
    q.query<PaymentRow & { collection_number: string | null; notes: string | null; recorded_by_name: string | null; reversal: { reason: string; reversed_at: string } | null; allocations: { invoice_id: string; invoice_number: string; amount: string; reversal: boolean; created_at: string }[] }>(
      `select pb.*, c.name as counterparty, p.notes, pr.full_name as recorded_by_name,
              dc.id as collection_id, dc.collection_number, wp.full_name as collected_by,
              (select jsonb_build_object('reason', r.reason, 'reversed_at', r.reversed_at) from public.payment_reversals r where r.payment_id = p.id) as reversal,
              coalesce((select jsonb_agg(jsonb_build_object('invoice_id', i.id, 'invoice_number', i.invoice_number, 'amount', a.amount::text,
                   'reversal', a.reversal_of is not null, 'created_at', a.created_at) order by a.created_at)
                 from public.payment_allocations a join public.invoices i on i.id = a.invoice_id where a.payment_id = p.id), '[]') as allocations
         from public.payment_balances pb join public.payments p on p.id = pb.payment_id
         join public.companies c on c.id = pb.retailer_id
         left join public.profiles pr on pr.id = p.recorded_by
         left join public.delivery_collections dc on dc.payment_id = p.id
         left join public.profiles wp on wp.id = dc.worker_id
        where pb.payment_id = $1`,
      [paymentId],
    ),
  );
  if (!rows[0]) throw new AppError("not_found", "Payment not found");
  return rows[0];
}

export const recordPaymentSchema = z.object({
  wholesaler_id: uuid,
  retailer_id: uuid,
  amount: positiveMoney,
  method: z.enum(["cash", "bank_transfer", "upi", "cheque", "other"]),
  reference: optionalText(100),
  received_on: z.string().date("Enter the payment date"),
  notes: optionalText(500),
  idempotency_key: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/),
  allocation_mode: z.enum(["auto", "manual", "none"]).default("auto"),
  allocations: z.array(z.object({ invoice_id: uuid, amount: z.string() })).default([]),
});

/** Record money received. Retries with the same idempotency key return the same payment. */
export async function recordPayment(userId: string, input: unknown): Promise<string> {
  const r = recordPaymentSchema.safeParse(input);
  if (!r.success) throw new AppError("validation", "Please correct the highlighted fields", fieldErrors(r.error));
  const d = r.data;
  let allocations: { invoice_id: string; amount: string }[] | null = null;
  if (d.allocation_mode === "none") allocations = [];
  if (d.allocation_mode === "manual") {
    allocations = d.allocations.filter((a) => a.amount.trim() !== "" && Number(a.amount) !== 0);
    for (const a of allocations) {
      if (!/^\d{1,10}(\.\d{1,2})?$/.test(a.amount)) throw new AppError("validation", "Allocation amounts must be in rupees and paise");
    }
    const total = allocations.reduce((s, a) => s + paise(a.amount), 0n);
    if (total > paise(d.amount)) {
      throw new AppError("validation", `Allocations (${rupees(total)}) exceed the payment amount (${d.amount})`);
    }
  }
  // Payment time: the chosen date at the current IST clock time (or noon for past dates).
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const receivedAt = d.received_on === today ? new Date().toISOString() : `${d.received_on}T12:00:00+05:30`;
  return userTx(userId, (q) =>
    callFn<string>(q, "record_payment", [
      d.wholesaler_id,
      d.retailer_id,
      d.amount,
      d.method,
      d.reference ?? null,
      receivedAt,
      d.notes ?? null,
      d.idempotency_key,
      allocations === null ? null : json(allocations),
    ]),
  );
}

export async function allocatePayment(userId: string, paymentId: string, invoiceId: string, amount: string) {
  uuid.parse(paymentId);
  uuid.parse(invoiceId);
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) throw new AppError("validation", "Enter a positive amount");
  await userTx(userId, (q) => callFn(q, "allocate_payment", [paymentId, invoiceId, amount]));
}

export async function reversePayment(userId: string, paymentId: string, reason: string) {
  uuid.parse(paymentId);
  await userTx(userId, (q) => callFn(q, "reverse_payment", [paymentId, reason.trim()]));
}

export async function openInvoices(userId: string, wholesalerId: string, retailerId: string) {
  return userTx(userId, (q) =>
    q.query<{ invoice_id: string; invoice_number: string; invoice_date: string; due_date: string; grand_total: string; due: string; payment_status: string }>(
      `select invoice_id, invoice_number, invoice_date::text, due_date::text, grand_total, due, payment_status from public.invoice_balances
        where wholesaler_id = $1 and retailer_id = $2 and status = 'issued' and due > 0 order by due_date, invoice_date`,
      [wholesalerId, retailerId],
    ),
  );
}

// ---------------------------------------------------------------------------
// Balances and statements
// ---------------------------------------------------------------------------
export interface BalanceRow {
  retailer_id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  relationship_status: string;
  credit_limit: string | null;
  invoiced: string;
  credited: string;
  received: string;
  outstanding: string;
  unapplied: string;
  overdue: string;
  oldest_due_date: string | null;
  total_count: number;
}

export async function listBalances(
  userId: string,
  wholesalerId: string,
  opts: { q?: string; filter?: string; sort?: string; page?: unknown; pageSize?: number },
): Promise<Page<BalanceRow> & { totals: { outstanding: string; overdue: string; unapplied: string } }> {
  const page = clampPage(opts.page);
  const size = opts.pageSize ?? 20;
  const order = opts.sort === "name" ? "c.name" : opts.sort === "overdue" ? "overdue desc, c.name" : "rb.outstanding desc, c.name";
  const filter = opts.filter === "all" ? "all" : opts.filter === "overdue" ? "overdue" : "outstanding";
  return userTx(userId, async (q) => {
    const rows = await q.query<BalanceRow>(
      `with od as (
         select retailer_id, sum(due) filter (where payment_status = 'overdue') as overdue, min(due_date) filter (where due > 0) as oldest_due_date
           from public.invoice_balances where wholesaler_id = $1 and status = 'issued' group by retailer_id)
       select rb.retailer_id, c.name, c.contact_name, c.phone, rb.relationship_status, rb.credit_limit, rb.invoiced, rb.credited,
              rb.received, rb.outstanding, rb.unapplied, coalesce(od.overdue, 0) as overdue, od.oldest_due_date::text,
              (count(*) over ())::int as total_count
         from public.retailer_balances rb join public.companies c on c.id = rb.retailer_id
         left join od on od.retailer_id = rb.retailer_id
        where rb.wholesaler_id = $1
          and ($2::text is null or c.name ilike '%' || $2 || '%')
          and ($3 = 'all' or ($3 = 'outstanding' and rb.outstanding <> 0) or ($3 = 'overdue' and coalesce(od.overdue, 0) > 0))
        order by ${order} limit $4 offset $5`,
      [wholesalerId, opts.q?.trim() || null, filter, size, (page - 1) * size],
    );
    const [totals] = await q.query<{ outstanding: string; overdue: string; unapplied: string }>(
      `select coalesce(sum(outstanding), 0) as outstanding, coalesce(sum(unapplied), 0) as unapplied,
              coalesce((select sum(due) from public.invoice_balances where wholesaler_id = $1 and payment_status = 'overdue'), 0) as overdue
         from public.retailer_balances where wholesaler_id = $1`,
      [wholesalerId],
    );
    return { ...pageOf(rows, page, size), totals: totals ?? { outstanding: "0", overdue: "0", unapplied: "0" } };
  });
}

export interface StatementLine {
  date: string;
  kind: "invoice" | "credit_note" | "payment" | "payment_reversal" | "invoice_void";
  reference: string;
  description: string;
  debit: string;
  credit: string;
  balance: string;
}

/** Customer statement: chronological documents with a running balance (positive = retailer owes). */
export async function getStatement(userId: string, wholesalerId: string, retailerId: string) {
  return userTx(userId, async (q) => {
    const [party] = await q.query<{ name: string; contact_name: string | null; phone: string | null; city: string | null; wholesaler_name: string }>(
      `select c.name, c.contact_name, c.phone, a.city, w.name as wholesaler_name
         from public.companies c left join public.business_addresses a on a.company_id = c.id and a.is_primary
         cross join public.companies w where c.id = $2 and w.id = $1`,
      [wholesalerId, retailerId],
    );
    if (!party) throw new AppError("not_found", "Customer not found");
    const docs = await q.query<{ date: string; sort_ts: Date; kind: StatementLine["kind"]; reference: string; description: string; debit: string; credit: string }>(
      `select * from (
         select i.invoice_date::text as date, i.created_at as sort_ts, 'invoice' as kind, i.invoice_number as reference,
                'Order ' || o.order_number as description, i.grand_total::text as debit, '0' as credit
           from public.invoices i join public.orders o on o.id = i.order_id where i.wholesaler_id = $1 and i.retailer_id = $2
         union all
         select (i.voided_at at time zone 'Asia/Kolkata')::date::text, i.voided_at, 'invoice_void', i.invoice_number, 'Invoice voided: ' || coalesce(i.void_reason, ''), '0', i.grand_total::text
           from public.invoices i where i.wholesaler_id = $1 and i.retailer_id = $2 and i.status = 'void'
         union all
         select cn.issued_on::text, cn.created_at, 'credit_note', cn.credit_note_number, 'Credit note: ' || cn.reason, '0', cn.amount::text
           from public.credit_notes cn where cn.wholesaler_id = $1 and cn.retailer_id = $2
         union all
         select (p.received_at at time zone 'Asia/Kolkata')::date::text, p.received_at, 'payment', p.payment_number,
                'Payment (' || replace(p.method::text, '_', ' ') || coalesce(', ref ' || p.reference, '') || ')', '0', p.amount::text
           from public.payments p where p.wholesaler_id = $1 and p.retailer_id = $2
         union all
         select (r.reversed_at at time zone 'Asia/Kolkata')::date::text, r.reversed_at, 'payment_reversal', p.payment_number,
                'Payment reversed: ' || r.reason, p.amount::text, '0'
           from public.payment_reversals r join public.payments p on p.id = r.payment_id where p.wholesaler_id = $1 and p.retailer_id = $2
       ) d order by date, sort_ts`,
      [wholesalerId, retailerId],
    );
    let running = 0n;
    let debits = 0n;
    let credits = 0n;
    const lines: StatementLine[] = docs.map((d) => {
      running += paise(d.debit) - paise(d.credit);
      debits += paise(d.debit);
      credits += paise(d.credit);
      return { date: d.date, kind: d.kind, reference: d.reference, description: d.description, debit: d.debit, credit: d.credit, balance: rupees(running) };
    });
    return { party, lines, totals: { debit: rupees(debits), credit: rupees(credits), balance: rupees(running) } };
  });
}

export async function reconcileReceivables(userId: string, wholesalerId: string) {
  return userTx(userId, (q) =>
    q.query<{ retailer_id: string; ledger_balance: string; document_balance: string; difference: string }>(
      "select * from app.reconcile_receivables($1)",
      [wholesalerId],
    ),
  );
}

/** Retailer-side summary across all wholesalers. */
export async function retailerBalances(userId: string, retailerId: string) {
  return userTx(userId, (q) =>
    q.query<{ wholesaler_id: string; name: string; invoiced: string; credited: string; received: string; outstanding: string; unapplied: string; whatsapp_number: string | null }>(
      `select rb.wholesaler_id, c.name, rb.invoiced, rb.credited, rb.received, rb.outstanding, rb.unapplied, wp.whatsapp_number
         from public.retailer_balances rb join public.companies c on c.id = rb.wholesaler_id
         left join public.wholesaler_profiles wp on wp.company_id = rb.wholesaler_id
        where rb.retailer_id = $1 order by rb.outstanding desc, c.name`,
      [retailerId],
    ),
  );
}

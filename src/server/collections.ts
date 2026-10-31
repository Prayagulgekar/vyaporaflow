import "server-only";
import { z } from "zod";
import { AppError } from "@/server/errors";
import type { Queryable } from "@/server/db";
import { callFn, clampPage, json, pageOf, userTx, type Page } from "@/server/rpc";
import { fieldErrors, money, optionalText, positiveMoney, uuid } from "@/server/validation";

/**
 * Delivery cash collections and cash handovers. All writes go through the
 * app.* functions in migration 20261029000100, which authorize the caller and
 * validate every amount against the database; nothing here trusts a total
 * sent by the browser.
 */

export interface OrderPosition {
  order_value: string;
  credited: string;
  paid: string;
  balance_due: string;
  invoice_id: string | null;
  invoice_number: string | null;
}

export interface CollectionRow {
  collection_id: string;
  collection_number: string;
  order_id: string;
  order_number: string;
  delivery_id: string;
  retailer_id: string;
  retailer_name: string;
  worker_id: string;
  worker_name: string | null;
  payment_id: string | null;
  payment_number: string | null;
  amount: string;
  method: "cash" | "upi";
  reference: string | null;
  note: string | null;
  collected_at: Date;
  order_value: string;
  payable_before: string;
  handed_over: string;
  pending_handover: string;
  handover_status: string;
  status: "recorded" | "reversed";
  balance_due_now: string | null;
  total_count: number;
}

const COLLECTION_SELECT = `
  select b.collection_id, b.collection_number, b.order_id, o.order_number, b.delivery_id, b.retailer_id, rc.name as retailer_name,
         b.worker_id, w.full_name as worker_name, b.payment_id, b.payment_number, b.amount, b.method, b.reference, b.note,
         b.collected_at, b.order_value, b.payable_before, b.handed_over, b.pending_handover, b.handover_status, b.status,
         (select pos.balance_due from app.order_position(b.order_id) pos) as balance_due_now
    from public.delivery_collection_balances b
    join public.orders o on o.id = b.order_id
    join public.companies rc on rc.id = b.retailer_id
    left join public.profiles w on w.id = b.worker_id`;

/** IST datetime-local ("2026-10-29T14:05") to an ISO timestamp; empty means now. */
function istLocalToIso(v: string | undefined): string | null {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) throw new AppError("validation", "Enter the collection date and time", { collected_at: ["Enter a valid date and time"] });
  return `${v}:00+05:30`;
}

const key = z.string().min(8).max(90).regex(/^[A-Za-z0-9_-]+$/, "Invalid submission key");

const collectionFields = {
  delivery_id: uuid,
  amount: money,
  method: z.enum(["cash", "upi"]),
  reference: optionalText(100),
  collection_note: optionalText(500),
  collected_at: optionalText(16),
  idempotency_key: key,
};

// ---------------------------------------------------------------------------
// Delivery worker
// ---------------------------------------------------------------------------

/** Money position of the order behind one of the worker's deliveries, plus what they recorded on it. */
export async function getDeliveryCollection(userId: string, deliveryId: string) {
  if (!uuid.safeParse(deliveryId).success) throw new AppError("not_found", "Delivery not found");
  return userTx(userId, async (q) => {
    const [d] = await q.query<{ order_id: string }>("select order_id from public.my_deliveries where id = $1", [deliveryId]);
    if (!d) throw new AppError("not_found", "Delivery not found or not assigned to you");
    const [position] = await q.query<OrderPosition>("select * from app.order_position($1)", [d.order_id]);
    const collections = await q.query<CollectionRow>(`${COLLECTION_SELECT} where b.delivery_id = $1 and b.worker_id = auth.uid() order by b.collected_at`, [deliveryId]);
    return { position: position ?? null, collections };
  });
}

const completeSchema = z.object({
  ...collectionFields,
  to: z.enum(["delivered", "partially_delivered"]),
  note: optionalText(1000),
  recipient_name: optionalText(120),
  empties_collected: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.coerce.number().int().min(0).max(1000).optional()),
  items: z.array(z.object({ order_item_id: uuid, delivered_quantity: z.string().regex(/^\d{1,7}(\.\d{1,3})?$/) })).optional(),
});

/** Mark delivered and record the collection in one transaction. Returns the collection. */
export async function completeDelivery(userId: string, input: unknown) {
  const r = completeSchema.safeParse(input);
  if (!r.success) throw new AppError("validation", "Please correct the highlighted fields", fieldErrors(r.error));
  const d = r.data;
  const at = istLocalToIso(d.collected_at);
  return userTx(userId, async (q) => {
    const id = await callFn<string>(q, "complete_delivery", [
      d.delivery_id,
      d.to,
      d.note ?? null,
      d.to === "partially_delivered" ? json(d.items ?? []) : null,
      d.recipient_name ?? null,
      d.empties_collected ?? null,
      d.amount,
      d.method,
      d.reference ?? null,
      d.collection_note ?? null,
      at,
      d.idempotency_key,
    ]);
    return receipt(q, id);
  });
}

const recordSchema = z.object(collectionFields);

/** Record a collection on a delivery that is already marked delivered. */
export async function recordCollection(userId: string, input: unknown) {
  const r = recordSchema.safeParse(input);
  if (!r.success) throw new AppError("validation", "Please correct the highlighted fields", fieldErrors(r.error));
  const d = r.data;
  const at = istLocalToIso(d.collected_at);
  return userTx(userId, async (q) => {
    const id = await callFn<string>(q, "record_delivery_collection", [d.delivery_id, d.amount, d.method, d.reference ?? null, d.collection_note ?? null, at, d.idempotency_key]);
    return receipt(q, id);
  });
}

async function receipt(q: Queryable, id: string) {
  const [row] = await q.query<{ collection_number: string; payment_number: string | null; amount: string; method: string; balance_due: string }>(
    `select c.collection_number, c.payment_number, c.amount::text, c.method,
            (select pos.balance_due::text from app.order_position(c.order_id) pos) as balance_due
       from public.delivery_collections c where c.id = $1`,
    [id],
  );
  if (!row) throw new AppError("not_found", "Collection not found");
  return { id, ...row };
}

/** The signed-in worker's own collections and the cash they still hold. */
export async function myCollections(userId: string) {
  return userTx(userId, async (q) => {
    const rows = await q.query<CollectionRow>(`${COLLECTION_SELECT} where b.worker_id = auth.uid() order by b.collected_at desc limit 100`);
    const [totals] = await q.query<{ pending: string; collected_today: string }>(
      `select coalesce(sum(pending_handover), 0)::text as pending,
              coalesce(sum(amount) filter (where status = 'recorded' and method = 'cash'
                and (collected_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date), 0)::text as collected_today
         from public.delivery_collection_balances where worker_id = auth.uid()`,
    );
    const handovers = await q.query<HandoverRow>(`${HANDOVER_SELECT} where h.worker_id = auth.uid() order by h.received_at desc limit 50`);
    return { rows, totals: totals ?? { pending: "0", collected_today: "0" }, handovers };
  });
}

// ---------------------------------------------------------------------------
// Wholesaler: reporting
// ---------------------------------------------------------------------------

export interface CashFilters {
  from: string;
  to: string;
  worker?: string;
  retailer?: string;
  order?: string;
  status?: string;
  page?: unknown;
}

const STATUSES = ["pending", "partially_handed_over", "handed_over", "not_required", "no_payment", "reversed", "open"];

export function normalizeCashFilters(sp: Record<string, string | undefined>, today: string): CashFilters {
  const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  const weekAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
  let from = isDate(sp.from) ? sp.from! : weekAgo;
  let to = isDate(sp.to) ? sp.to! : today;
  if (from > to) [from, to] = [to, from];
  return {
    from,
    to,
    worker: uuid.safeParse(sp.worker).success ? sp.worker : undefined,
    retailer: uuid.safeParse(sp.retailer).success ? sp.retailer : undefined,
    order: sp.order?.trim().slice(0, 40) || undefined,
    status: STATUSES.includes(sp.status ?? "") ? sp.status : undefined,
    page: sp.page,
  };
}

export interface WorkerSummary {
  worker_id: string;
  worker_name: string;
  completed_deliveries: number;
  deliveries_without_collection: number;
  order_value: string;
  retailer_balance_due: string;
  cash_collected: string;
  upi_collected: string;
  cash_handed_over: string;
  cash_pending: string;
  cash_pending_all_dates: string;
}

/** Per-worker totals for the date range: deliveries by delivery date, collections by collection date. */
export async function cashSummary(userId: string, wholesalerId: string, f: CashFilters): Promise<WorkerSummary[]> {
  return userTx(userId, (q) =>
    q.query<WorkerSummary>(
      `with dl as (
         select d.assigned_worker_id as worker_id, count(*)::int as n,
                count(*) filter (where not exists (select 1 from public.delivery_collections c where c.delivery_id = d.id))::int as missing,
                coalesce(sum(pos.order_value), 0) as order_value, coalesce(sum(greatest(pos.balance_due, 0)), 0) as due
           from public.deliveries d join public.orders o on o.id = d.order_id
           cross join lateral app.order_position(d.order_id) pos
          where d.wholesaler_id = $1 and d.status in ('delivered', 'partially_delivered') and d.assigned_worker_id is not null
            and (d.delivered_at at time zone 'Asia/Kolkata')::date between $2::date and $3::date
            and ($4::uuid is null or d.assigned_worker_id = $4) and ($5::uuid is null or o.retailer_id = $5)
            and ($6::text is null or o.order_number ilike '%' || $6 || '%')
          group by 1),
       cl as (
         select b.worker_id,
                coalesce(sum(b.amount) filter (where b.status = 'recorded' and b.method = 'cash'), 0) as cash,
                coalesce(sum(b.amount) filter (where b.status = 'recorded' and b.method = 'upi'), 0) as upi,
                coalesce(sum(b.handed_over), 0) as handed, coalesce(sum(b.pending_handover), 0) as pending
           from public.delivery_collection_balances b join public.orders o on o.id = b.order_id
          where b.wholesaler_id = $1 and (b.collected_at at time zone 'Asia/Kolkata')::date between $2::date and $3::date
            and ($4::uuid is null or b.worker_id = $4) and ($5::uuid is null or b.retailer_id = $5)
            and ($6::text is null or o.order_number ilike '%' || $6 || '%')
          group by 1),
       al as (
         select worker_id, sum(pending_handover) as pending from public.delivery_collection_balances
          where wholesaler_id = $1 and ($4::uuid is null or worker_id = $4) group by 1 having sum(pending_handover) > 0)
       select w.worker_id, coalesce(nullif(p.full_name, ''), p.email, 'Former team member') as worker_name,
              coalesce(dl.n, 0) as completed_deliveries, coalesce(dl.missing, 0) as deliveries_without_collection,
              coalesce(dl.order_value, 0)::text as order_value, coalesce(dl.due, 0)::text as retailer_balance_due,
              coalesce(cl.cash, 0)::text as cash_collected, coalesce(cl.upi, 0)::text as upi_collected,
              coalesce(cl.handed, 0)::text as cash_handed_over, coalesce(cl.pending, 0)::text as cash_pending,
              coalesce(al.pending, 0)::text as cash_pending_all_dates
         from (select worker_id from dl union select worker_id from cl union select worker_id from al) w
         left join dl on dl.worker_id = w.worker_id left join cl on cl.worker_id = w.worker_id left join al on al.worker_id = w.worker_id
         left join public.profiles p on p.id = w.worker_id
        order by coalesce(al.pending, 0) desc, worker_name`,
      [wholesalerId, f.from, f.to, f.worker ?? null, f.retailer ?? null, f.order ?? null],
    ),
  );
}

export async function listCollections(userId: string, wholesalerId: string, f: CashFilters, pageSize = 20): Promise<Page<CollectionRow>> {
  const page = clampPage(f.page);
  const rows = await userTx(userId, (q) =>
    q.query<CollectionRow>(
      `select x.*, (count(*) over ())::int as total_count from (${COLLECTION_SELECT}
        where b.wholesaler_id = $1 and (b.collected_at at time zone 'Asia/Kolkata')::date between $2::date and $3::date
          and ($4::uuid is null or b.worker_id = $4) and ($5::uuid is null or b.retailer_id = $5)
          and ($6::text is null or o.order_number ilike '%' || $6 || '%')
          and ($7::text is null or ($7 = 'open' and b.pending_handover > 0) or b.handover_status = $7)) x
        order by x.collected_at desc limit $8 offset $9`,
      [wholesalerId, f.from, f.to, f.worker ?? null, f.retailer ?? null, f.order ?? null, f.status ?? null, pageSize, (page - 1) * pageSize],
    ),
  );
  return pageOf(rows, page, pageSize);
}

export async function getCollection(userId: string, collectionId: string) {
  if (!uuid.safeParse(collectionId).success) throw new AppError("not_found", "Collection not found");
  return userTx(userId, async (q) => {
    const [row] = await q.query<CollectionRow & { recorded_by_name: string | null; reversal_reason: string | null; reversed_at: Date | null; wholesaler_id: string }>(
      `select x.*, rb.full_name as recorded_by_name, c.reversal_reason, c.reversed_at, c.wholesaler_id
         from (${COLLECTION_SELECT} where b.collection_id = $1) x
         join public.delivery_collections c on c.id = x.collection_id
         left join public.profiles rb on rb.id = c.recorded_by`,
      [collectionId],
    );
    if (!row) throw new AppError("not_found", "Collection not found");
    const [position] = await q.query<OrderPosition>("select * from app.order_position($1)", [row.order_id]);
    const handovers = await q.query<{ handover_id: string; handover_number: string; amount: string; received_at: Date; received_by_name: string | null; status: string }>(
      `select h.id as handover_id, h.handover_number, i.amount, h.received_at, rp.full_name as received_by_name, h.status
         from public.cash_handover_items i join public.cash_handovers h on h.id = i.handover_id
         left join public.profiles rp on rp.id = h.received_by
        where i.collection_id = $1 order by h.received_at`,
      [collectionId],
    );
    return { ...row, position: position ?? null, handovers };
  });
}

/** People who can hold cash: active members who have deliveries or collections. */
export async function listCashWorkers(userId: string, wholesalerId: string) {
  return userTx(userId, (q) =>
    q.query<{ user_id: string; full_name: string; pending: string }>(
      `select p.id as user_id, coalesce(nullif(p.full_name, ''), p.email) as full_name,
              coalesce((select sum(pending_handover) from public.delivery_collection_balances b where b.wholesaler_id = $1 and b.worker_id = p.id), 0)::text as pending
         from public.profiles p
        where p.id in (select user_id from public.company_memberships where company_id = $1 and status = 'active')
           or p.id in (select worker_id from public.delivery_collections where wholesaler_id = $1)
        order by p.full_name`,
      [wholesalerId],
    ),
  );
}

export async function listCompanyRetailers(userId: string, wholesalerId: string) {
  return userTx(userId, (q) =>
    q.query<{ id: string; name: string }>(
      `select c.id, c.name from public.retailer_wholesaler_relationships r join public.companies c on c.id = r.retailer_id
        where r.wholesaler_id = $1 order by c.name`,
      [wholesalerId],
    ),
  );
}

/** Unapplied payments the office recorded by hand for these retailers (possible double counting to check). */
export async function manualAdvances(userId: string, wholesalerId: string, retailerIds: string[]) {
  if (retailerIds.length === 0) return [];
  return userTx(userId, (q) =>
    q.query<{ retailer_id: string; retailer_name: string; unapplied: string; payments: number }>(
      `select pb.retailer_id, c.name as retailer_name, sum(pb.unapplied)::text as unapplied, count(*)::int as payments
         from public.payment_balances pb join public.companies c on c.id = pb.retailer_id
        where pb.wholesaler_id = $1 and pb.retailer_id = any ($2::uuid[]) and pb.unapplied > 0 and pb.status = 'posted'
          and not exists (select 1 from public.delivery_collections dc where dc.payment_id = pb.payment_id)
        group by 1, 2 order by 2`,
      [wholesalerId, retailerIds],
    ),
  );
}

// ---------------------------------------------------------------------------
// Wholesaler: handovers
// ---------------------------------------------------------------------------

export interface HandoverRow {
  handover_id: string;
  handover_number: string;
  worker_id: string;
  worker_name: string | null;
  expected_amount: string;
  received_amount: string;
  discrepancy: string;
  note: string | null;
  received_by_name: string | null;
  received_at: Date;
  status: "confirmed" | "reversed";
  reversal_reason: string | null;
  reversed_at: Date | null;
  reversed_by_name: string | null;
  collections: number;
}

const HANDOVER_SELECT = `
  select h.id as handover_id, h.handover_number, h.worker_id, w.full_name as worker_name, h.expected_amount, h.received_amount,
         h.discrepancy, h.note, rb.full_name as received_by_name, h.received_at, h.status, h.reversal_reason, h.reversed_at,
         rv.full_name as reversed_by_name, (select count(*)::int from public.cash_handover_items i where i.handover_id = h.id) as collections
    from public.cash_handovers h
    left join public.profiles w on w.id = h.worker_id
    left join public.profiles rb on rb.id = h.received_by
    left join public.profiles rv on rv.id = h.reversed_by`;

export async function listHandovers(userId: string, wholesalerId: string, opts: { worker?: string; limit?: number }) {
  return userTx(userId, (q) =>
    q.query<HandoverRow>(`${HANDOVER_SELECT} where h.wholesaler_id = $1 and ($2::uuid is null or h.worker_id = $2) order by h.received_at desc limit $3`, [
      wholesalerId,
      opts.worker && uuid.safeParse(opts.worker).success ? opts.worker : null,
      opts.limit ?? 50,
    ]),
  );
}

export async function getHandover(userId: string, handoverId: string) {
  if (!uuid.safeParse(handoverId).success) throw new AppError("not_found", "Handover not found");
  return userTx(userId, async (q) => {
    const [h] = await q.query<HandoverRow & { wholesaler_id: string }>(`select x.*, h.wholesaler_id from (${HANDOVER_SELECT} where h.id = $1) x join public.cash_handovers h on h.id = x.handover_id`, [handoverId]);
    if (!h) throw new AppError("not_found", "Handover not found");
    const items = await q.query<{ collection_id: string; collection_number: string; order_number: string; retailer_name: string; collected: string; amount: string; pending_now: string }>(
      `select c.id as collection_id, c.collection_number, o.order_number, rc.name as retailer_name, c.amount as collected, i.amount,
              b.pending_handover as pending_now
         from public.cash_handover_items i join public.delivery_collections c on c.id = i.collection_id
         join public.delivery_collection_balances b on b.collection_id = c.id
         join public.orders o on o.id = c.order_id join public.companies rc on rc.id = c.retailer_id
        where i.handover_id = $1 order by c.collected_at`,
      [handoverId],
    );
    return { ...h, items };
  });
}

/** A worker's collections with cash still to hand over, oldest first. */
export async function pendingCash(userId: string, wholesalerId: string, workerId: string) {
  if (!uuid.safeParse(workerId).success) return [];
  return userTx(userId, (q) =>
    q.query<CollectionRow>(`${COLLECTION_SELECT} where b.wholesaler_id = $1 and b.worker_id = $2 and b.pending_handover > 0 order by b.collected_at, b.collection_id`, [
      wholesalerId,
      workerId,
    ]),
  );
}

const handoverSchema = z.object({
  wholesaler_id: uuid,
  worker_id: uuid,
  collection_ids: z.array(uuid).min(1, "Choose at least one collection"),
  expected: money,
  received: positiveMoney,
  note: optionalText(500),
  idempotency_key: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/),
});

export async function confirmHandover(userId: string, input: unknown): Promise<string> {
  const r = handoverSchema.safeParse(input);
  if (!r.success) throw new AppError("validation", "Please correct the highlighted fields", fieldErrors(r.error));
  const d = r.data;
  return userTx(userId, (q) =>
    callFn<string>(q, "confirm_cash_handover", [d.wholesaler_id, d.worker_id, d.collection_ids, d.expected, d.received, d.note ?? null, d.idempotency_key]),
  );
}

export async function reverseHandover(userId: string, handoverId: string, reason: string) {
  uuid.parse(handoverId);
  await userTx(userId, (q) => callFn(q, "reverse_cash_handover", [handoverId, reason.trim()]));
}

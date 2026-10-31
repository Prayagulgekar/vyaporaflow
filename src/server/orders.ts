import "server-only";
import { z } from "zod";
import { ORDER_STATUSES, type OrderStatus } from "@/domain/order-status";
import { AppError } from "@/server/errors";
import { callFn, clampPage, json, pageOf, userTx, type Page } from "@/server/rpc";
import { fieldErrors, uuid } from "@/server/validation";

export interface OrderListRow {
  id: string;
  order_number: string;
  wholesaler_id: string;
  retailer_id: string;
  retailer_name: string;
  wholesaler_name: string;
  status: OrderStatus;
  items_count: number;
  grand_total: string;
  placed_at: Date;
  delivery_status: string | null;
  payment_status: string;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_due: string | null;
  partially_delivered: boolean;
  total_count: number;
}

const ORDER_SORTS: Record<string, string> = {
  placed_at: "o.placed_at",
  grand_total: "o.grand_total",
  retailer: "o.retailer_name",
  status: "o.status",
};

export interface OrderFilters {
  q?: string;
  status?: string;
  payment?: string;
  from?: string;
  to?: string;
  sort?: string;
  dir?: string;
  page?: unknown;
  pageSize?: number;
}

async function listOrders(userId: string, side: "wholesaler" | "retailer", companyId: string, f: OrderFilters): Promise<Page<OrderListRow>> {
  const page = clampPage(f.page);
  const size = f.pageSize ?? 15;
  const sortCol = ORDER_SORTS[f.sort ?? ""] ?? "o.placed_at";
  const dir = f.dir === "asc" ? "asc" : "desc";
  const status = f.status === "open" ? "open" : (ORDER_STATUSES as readonly string[]).includes(f.status ?? "") ? f.status : null;
  const payment = ["not_invoiced", "unpaid", "partially_paid", "paid", "overdue"].includes(f.payment ?? "") ? f.payment : null;
  const date = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const rows = await userTx(userId, (q) =>
    q.query<OrderListRow>(
      `select o.id, o.order_number, o.wholesaler_id, o.retailer_id, o.retailer_name, o.wholesaler_name, o.status, o.items_count,
              o.grand_total, o.placed_at, o.delivery_status, o.payment_status, o.invoice_id, o.invoice_number, o.invoice_due,
              o.partially_delivered, (count(*) over ())::int as total_count
         from public.order_overview o
        where o.${side}_id = $1
          and ($2::text is null or o.order_number ilike '%' || $2 || '%' or o.retailer_name ilike '%' || $2 || '%' or o.wholesaler_name ilike '%' || $2 || '%')
          and ($3::text is null or ($3 = 'open' and o.status not in ('delivered', 'cancelled')) or o.status::text = $3)
          and ($4::text is null or o.payment_status = $4)
          and ($5::date is null or (o.placed_at at time zone 'Asia/Kolkata')::date >= $5)
          and ($6::date is null or (o.placed_at at time zone 'Asia/Kolkata')::date <= $6)
        order by ${sortCol} ${dir}, o.id
        limit $7 offset $8`,
      [companyId, f.q?.trim() || null, status, payment, date(f.from), date(f.to), size, (page - 1) * size],
    ),
  );
  return pageOf(rows, page, size);
}

export const listWholesalerOrders = (userId: string, wholesalerId: string, f: OrderFilters) => listOrders(userId, "wholesaler", wholesalerId, f);
export const listRetailerOrders = (userId: string, retailerId: string, f: OrderFilters) => listOrders(userId, "retailer", retailerId, f);

export interface OrderItemRow {
  id: string;
  line_no: number;
  product_id: string;
  variant_id: string;
  variant_unit_id: string | null;
  product_name: string;
  variant_name: string;
  sku: string;
  hsn_code: string | null;
  unit_code: string;
  unit_factor: string;
  base_unit: string;
  quantity: string;
  base_quantity: string;
  unit_price: string;
  price_includes_tax: boolean;
  discount_percent: string;
  line_amount: string;
  discount_amount: string;
  taxable_amount: string;
  tax_rate: string;
  tax_amount: string;
  line_total: string;
  delivered_quantity: string | null;
}

export interface OrderDetail extends Omit<OrderListRow, "total_count"> {
  placed_by_name: string | null;
  delivery_address: { label?: string; line1: string; line2?: string | null; city: string; state_code: string; pincode: string };
  place_of_supply: string;
  subtotal: string;
  discount_total: string;
  taxable_total: string;
  tax_total: string;
  delivery_charge: string;
  notes: string | null;
  cancel_reason: string | null;
  accepted_at: Date | null;
  dispatched_at: Date | null;
  delivered_at: Date | null;
  cancelled_at: Date | null;
  delivery_id: string | null;
  assigned_worker_id: string | null;
  assigned_worker_name: string | null;
  retailer: { name: string; contact_name: string | null; phone: string | null; gstin: string | null };
  wholesaler: { name: string; phone: string | null; whatsapp: string | null };
  items: OrderItemRow[];
  events: { id: number; event_type: string; from_status: string | null; to_status: string | null; note: string | null; actor_name: string | null; created_at: Date }[];
  payments: { payment_number: string; amount: string; received_at: Date; method: string; status: string }[];
  delivery_events: { id: number; from_status: string | null; to_status: string; note: string | null; actor_name: string | null; created_at: Date }[];
}

export async function getOrder(userId: string, orderId: string): Promise<OrderDetail> {
  if (!uuid.safeParse(orderId).success) throw new AppError("not_found", "Order not found");
  const rows = await userTx(userId, (q) =>
    q.query<OrderDetail>(
      `select o.*, pb.full_name as placed_by_name, wk.full_name as assigned_worker_name,
              jsonb_build_object('name', rc.name, 'contact_name', rc.contact_name, 'phone', rc.phone, 'gstin', rc.gstin) as retailer,
              jsonb_build_object('name', wc.name, 'phone', wc.phone, 'whatsapp', wp.whatsapp_number) as wholesaler,
              coalesce((select jsonb_agg(to_jsonb(oi) order by oi.line_no) from public.order_items oi where oi.order_id = o.id), '[]') as items,
              coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'event_type', e.event_type, 'from_status', e.from_status,
                         'to_status', e.to_status, 'note', e.note, 'actor_name', ap.full_name, 'created_at', e.created_at) order by e.id)
                 from public.order_events e left join public.profiles ap on ap.id = e.actor_id where e.order_id = o.id), '[]') as events,
              coalesce((select jsonb_agg(jsonb_build_object('payment_number', p.payment_number, 'amount', a.amount, 'received_at', p.received_at,
                         'method', p.method, 'status', p.status) order by a.created_at)
                 from public.payment_allocations a join public.payments p on p.id = a.payment_id
                where a.invoice_id = o.invoice_id), '[]') as payments,
              coalesce((select jsonb_agg(jsonb_build_object('id', de.id, 'from_status', de.from_status, 'to_status', de.to_status,
                         'note', de.note, 'actor_name', dp.full_name, 'created_at', de.created_at) order by de.id)
                 from public.delivery_events de left join public.profiles dp on dp.id = de.actor_id where de.delivery_id = o.delivery_id), '[]') as delivery_events
         from public.order_overview o
         join public.companies rc on rc.id = o.retailer_id
         join public.companies wc on wc.id = o.wholesaler_id
         left join public.wholesaler_profiles wp on wp.company_id = o.wholesaler_id
         left join public.profiles pb on pb.id = o.placed_by
         left join public.profiles wk on wk.id = o.assigned_worker_id
        where o.id = $1`,
      [orderId],
    ),
  );
  const o = rows[0];
  if (!o) throw new AppError("not_found", "Order not found");
  for (const e of o.events) e.created_at = new Date(e.created_at);
  for (const e of o.delivery_events) e.created_at = new Date(e.created_at);
  for (const p of o.payments) p.received_at = new Date(p.received_at);
  return o;
}

export async function transitionOrder(userId: string, orderId: string, to: string, note?: string | null) {
  if (!(ORDER_STATUSES as readonly string[]).includes(to)) throw new AppError("validation", "Unknown order status");
  uuid.parse(orderId);
  await userTx(userId, (q) => callFn(q, "transition_order", [orderId, to, note?.slice(0, 1000) || null]));
}

// ---------------------------------------------------------------------------
// Quotes and order placement
// ---------------------------------------------------------------------------
export interface QuoteLine {
  line_no: number;
  variant_unit_id: string;
  product_id: string;
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  unit_code: string;
  unit_factor: string;
  base_unit: string;
  quantity: string;
  base_quantity: string;
  unit_price: string;
  price_includes_tax: boolean;
  discount_percent: string;
  line_amount: string;
  discount_amount: string;
  taxable_amount: string;
  tax_rate: string;
  tax_amount: string;
  line_total: string;
  issues: string[];
}

export interface Quote {
  lines: QuoteLine[];
  errors: string[];
  subtotal: string;
  discount_total: string;
  taxable_total: string;
  tax_total: string;
  items_total: string;
  delivery_charge: string;
  grand_total: string;
  min_order_value: string;
}

/** Numbers inside the jsonb quote come back as JSON numbers; normalise to exact strings. */
function normaliseQuote(raw: Record<string, unknown>): Quote {
  const s = (v: unknown) => (v === null || v === undefined ? "0" : String(v));
  // Money amounts are 2-decimal NUMERICs in the database; restore the scale JSON drops (125 -> "125.00").
  const m = (v: unknown) => (v === null || v === undefined ? "0.00" : Number(v).toFixed(2));
  const lines = ((raw.lines as Record<string, unknown>[]) ?? []).map((l) => ({
    ...(l as unknown as QuoteLine),
    quantity: s(l.quantity),
    base_quantity: s(l.base_quantity),
    unit_factor: s(l.unit_factor),
    unit_price: m(l.unit_price),
    discount_percent: s(l.discount_percent),
    line_amount: m(l.line_amount),
    discount_amount: m(l.discount_amount),
    taxable_amount: m(l.taxable_amount),
    tax_rate: s(l.tax_rate),
    tax_amount: m(l.tax_amount),
    line_total: m(l.line_total),
    issues: (l.issues as string[]) ?? [],
  }));
  return {
    lines,
    errors: (raw.errors as string[]) ?? [],
    subtotal: m(raw.subtotal),
    discount_total: m(raw.discount_total),
    taxable_total: m(raw.taxable_total),
    tax_total: m(raw.tax_total),
    items_total: m(raw.items_total),
    delivery_charge: m(raw.delivery_charge),
    grand_total: m(raw.grand_total),
    min_order_value: m(raw.min_order_value),
  };
}

const itemsSchema = z
  .array(
    z.object({
      variant_unit_id: uuid,
      quantity: z.union([z.string(), z.number()]).transform((v) => String(v).trim()).pipe(z.string().regex(/^\d{1,7}(\.\d{1,3})?$/, "Invalid quantity")),
    }),
  )
  .min(1, "Add at least one product")
  .max(200);

export type OrderItemsInput = z.input<typeof itemsSchema>;

function parseItems(items: unknown) {
  const r = itemsSchema.safeParse(items);
  if (!r.success) throw new AppError("validation", "The order items are not valid", fieldErrors(r.error));
  return r.data;
}

export async function quoteOrder(userId: string, retailerId: string, wholesalerId: string, items: unknown): Promise<Quote> {
  const parsed = parseItems(items);
  const raw = await userTx(userId, (q) => callFn<Record<string, unknown>>(q, "quote_order", [retailerId, wholesalerId, json(parsed)]));
  return normaliseQuote(raw);
}

export const placeOrderSchema = z.object({
  retailer_id: uuid,
  wholesaler_id: uuid,
  items: itemsSchema,
  idempotency_key: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/, "Invalid idempotency key"),
  notes: z.preprocess((v) => (v === "" ? undefined : v), z.string().max(1000).optional()),
  address_id: z.preprocess((v) => (v === "" ? undefined : v), uuid.optional()),
});

/**
 * Place an order. Only product references and quantities are accepted from the
 * client; prices, discounts, taxes, delivery charges and totals are computed by
 * app.place_order() from database records. Any client-sent totals are ignored.
 */
export async function placeOrder(userId: string, input: unknown): Promise<string> {
  const r = placeOrderSchema.safeParse(input);
  if (!r.success) throw new AppError("validation", "The order is not valid", fieldErrors(r.error));
  const d = r.data;
  return userTx(userId, (q) =>
    callFn<string>(q, "place_order", [d.retailer_id, d.wholesaler_id, json(d.items), d.idempotency_key, d.notes ?? null, d.address_id ?? null]),
  );
}

/** Add the still-available lines of a previous order to the cart. */
export async function reorder(userId: string, retailerId: string, orderId: string) {
  uuid.parse(orderId);
  return userTx(userId, async (q) => {
    const items = await q.query<{ variant_unit_id: string | null; quantity: string; wholesaler_id: string; product_name: string }>(
      `select oi.variant_unit_id, oi.quantity, o.wholesaler_id, oi.product_name from public.order_items oi
         join public.orders o on o.id = oi.order_id where oi.order_id = $1 and o.retailer_id = $2`,
      [orderId, retailerId],
    );
    if (!items.length) throw new AppError("not_found", "Order not found");
    let added = 0;
    const skipped: string[] = [];
    for (const it of items) {
      const visible = it.variant_unit_id
        ? await q.query("select 1 from public.variant_units where id = $1 and is_active", [it.variant_unit_id])
        : [];
      if (!visible.length) {
        skipped.push(it.product_name);
        continue;
      }
      await q.query(
        `insert into public.cart_items (retailer_id, wholesaler_id, variant_unit_id, quantity, added_by)
         values ($1, $2, $3, $4, auth.uid())
         on conflict (retailer_id, variant_unit_id) do update set quantity = excluded.quantity`,
        [retailerId, it.wholesaler_id, it.variant_unit_id, it.quantity],
      );
      added++;
    }
    return { added, skipped, wholesalerId: items[0]!.wholesaler_id };
  });
}

export async function orderStatusCounts(userId: string, wholesalerId: string) {
  return userTx(userId, (q) =>
    q.query<{ status: OrderStatus; n: number }>(
      "select status, count(*)::int as n from public.orders where wholesaler_id = $1 group by status",
      [wholesalerId],
    ),
  );
}

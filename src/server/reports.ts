import "server-only";
import { userTx } from "@/server/rpc";

export interface Period {
  from: string; // YYYY-MM-DD, inclusive, Asia/Kolkata
  to: string;
  label: string;
}

const istDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export function resolvePeriod(key: string | undefined, from?: string, to?: string): Period & { key: string } {
  const today = new Date();
  const t = istDate(today);
  const minus = (days: number) => istDate(new Date(today.getTime() - days * 86400_000));
  const valid = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  switch (key) {
    case "today":
      return { key, from: t, to: t, label: "Today" };
    case "7d":
      return { key, from: minus(6), to: t, label: "Last 7 days" };
    case "month": {
      const [y, m] = t.split("-");
      return { key, from: `${y}-${m}-01`, to: t, label: "This month" };
    }
    case "custom":
      if (valid(from) && valid(to) && from! <= to!) return { key, from: from!, to: to!, label: `${from} to ${to}` };
      return { key: "30d", from: minus(29), to: t, label: "Last 30 days" };
    default:
      return { key: "30d", from: minus(29), to: t, label: "Last 30 days" };
  }
}

export interface DashboardMetrics {
  orders_today: number;
  pipeline: Record<string, number>;
  delivered_in_period: number;
  orders_in_period: number;
  order_value: string;
  invoiced_sales: string;
  credit_notes: string;
  net_sales: string;
  payments_received: string;
  outstanding: string;
  overdue: string;
  low_stock: number;
  pending_retailers: number;
}

/** Every number is derived from business records at query time; nothing is stored or hardcoded. */
export async function dashboardMetrics(userId: string, wholesalerId: string, p: Period): Promise<DashboardMetrics> {
  const rows = await userTx(userId, (q) =>
    q.query<DashboardMetrics>(
      `with ist as (select (now() at time zone 'Asia/Kolkata')::date as today)
       select
         (select count(*)::int from public.orders o, ist where o.wholesaler_id = $1 and (o.placed_at at time zone 'Asia/Kolkata')::date = ist.today) as orders_today,
         (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*)::int n from public.orders
             where wholesaler_id = $1 and status not in ('delivered', 'cancelled') group by status) s) as pipeline,
         (select count(*)::int from public.orders where wholesaler_id = $1 and status = 'delivered'
             and (delivered_at at time zone 'Asia/Kolkata')::date between $2 and $3) as delivered_in_period,
         (select count(*)::int from public.orders where wholesaler_id = $1 and status <> 'cancelled'
             and (placed_at at time zone 'Asia/Kolkata')::date between $2 and $3) as orders_in_period,
         (select coalesce(sum(grand_total), 0) from public.orders where wholesaler_id = $1 and status <> 'cancelled'
             and (placed_at at time zone 'Asia/Kolkata')::date between $2 and $3) as order_value,
         (select coalesce(sum(grand_total), 0) from public.invoices where wholesaler_id = $1 and status = 'issued'
             and invoice_date between $2 and $3) as invoiced_sales,
         (select coalesce(sum(amount), 0) from public.credit_notes where wholesaler_id = $1 and issued_on between $2 and $3) as credit_notes,
         (select coalesce(sum(grand_total), 0) from public.invoices where wholesaler_id = $1 and status = 'issued' and invoice_date between $2 and $3)
           - (select coalesce(sum(amount), 0) from public.credit_notes where wholesaler_id = $1 and issued_on between $2 and $3) as net_sales,
         (select coalesce(sum(amount), 0) from public.payments where wholesaler_id = $1 and status = 'posted'
             and (received_at at time zone 'Asia/Kolkata')::date between $2 and $3) as payments_received,
         (select coalesce(sum(outstanding), 0) from public.retailer_balances where wholesaler_id = $1) as outstanding,
         (select coalesce(sum(due), 0) from public.invoice_balances where wholesaler_id = $1 and payment_status = 'overdue') as overdue,
         (select count(*)::int from public.inventory_overview where company_id = $1 and is_low and archived_at is null) as low_stock,
         (select count(*)::int from public.retailer_wholesaler_relationships where wholesaler_id = $1 and status = 'pending') as pending_retailers`,
      [wholesalerId, p.from, p.to],
    ),
  );
  return rows[0]!;
}

export async function salesByDay(userId: string, wholesalerId: string, p: Period) {
  return userTx(userId, (q) =>
    q.query<{ day: string; invoiced: string; collected: string; orders: number }>(
      `select d::date::text as day,
              coalesce((select sum(grand_total) from public.invoices where wholesaler_id = $1 and status = 'issued' and invoice_date = d::date), 0) as invoiced,
              coalesce((select sum(amount) from public.payments where wholesaler_id = $1 and status = 'posted'
                         and (received_at at time zone 'Asia/Kolkata')::date = d::date), 0) as collected,
              (select count(*)::int from public.orders where wholesaler_id = $1 and status <> 'cancelled'
                         and (placed_at at time zone 'Asia/Kolkata')::date = d::date) as orders
         from generate_series($2::date, $3::date, interval '1 day') d order by d`,
      [wholesalerId, p.from, p.to],
    ),
  );
}

export async function topProducts(userId: string, wholesalerId: string, p: Period) {
  return userTx(userId, (q) =>
    q.query<{ description: string; quantity: string; unit_code: string; taxable: string; total: string }>(
      `select ii.description, sum(ii.quantity)::text as quantity, ii.unit_code, sum(ii.taxable_amount) as taxable, sum(ii.line_total) as total
         from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
        where i.wholesaler_id = $1 and i.status = 'issued' and i.invoice_date between $2 and $3
        group by ii.description, ii.unit_code order by sum(ii.line_total) desc limit 10`,
      [wholesalerId, p.from, p.to],
    ),
  );
}

export async function collectionsByMethod(userId: string, wholesalerId: string, p: Period) {
  return userTx(userId, (q) =>
    q.query<{ method: string; count: number; amount: string }>(
      `select method, count(*)::int as count, sum(amount) as amount from public.payments
        where wholesaler_id = $1 and status = 'posted' and (received_at at time zone 'Asia/Kolkata')::date between $2 and $3
        group by method order by sum(amount) desc`,
      [wholesalerId, p.from, p.to],
    ),
  );
}

export async function taxSummary(userId: string, wholesalerId: string, p: Period) {
  return userTx(userId, (q) =>
    q.query<{ tax_rate: string; taxable: string; cgst: string; sgst: string; igst: string }>(
      `select ii.tax_rate::text, sum(ii.taxable_amount) as taxable, sum(ii.cgst_amount) as cgst, sum(ii.sgst_amount) as sgst, sum(ii.igst_amount) as igst
         from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
        where i.wholesaler_id = $1 and i.status = 'issued' and i.invoice_date between $2 and $3
        group by ii.tax_rate order by ii.tax_rate`,
      [wholesalerId, p.from, p.to],
    ),
  );
}

export async function receivablesAging(userId: string, wholesalerId: string) {
  return userTx(userId, (q) =>
    q.query<{ bucket: string; amount: string; invoices: number }>(
      `with b as (
         select due, greatest(0, (now() at time zone 'Asia/Kolkata')::date - due_date) as days
           from public.invoice_balances where wholesaler_id = $1 and status = 'issued' and due > 0)
       select bucket, coalesce(sum(due), 0) as amount, count(due)::int as invoices from (
         select case when days = 0 then '1 Not yet due' when days <= 30 then '2 1-30 days overdue' when days <= 60 then '3 31-60 days overdue'
                     when days <= 90 then '4 61-90 days overdue' else '5 More than 90 days overdue' end as bucket, due from b) x
        group by bucket order by bucket`,
      [wholesalerId],
    ),
  );
}

export async function exportOrdersCsv(userId: string, wholesalerId: string, p: Period) {
  return userTx(userId, (q) =>
    q.query<Record<string, unknown>>(
      `select order_number, (placed_at at time zone 'Asia/Kolkata')::text as placed_at_ist, retailer_name, status, items_count,
              subtotal, discount_total, taxable_total, tax_total, delivery_charge, grand_total, payment_status, invoice_number
         from public.order_overview where wholesaler_id = $1 and (placed_at at time zone 'Asia/Kolkata')::date between $2 and $3
        order by placed_at`,
      [wholesalerId, p.from, p.to],
    ),
  );
}

export async function exportInvoicesCsv(userId: string, wholesalerId: string, p: Period) {
  return userTx(userId, (q) =>
    q.query<Record<string, unknown>>(
      `select i.invoice_number, i.invoice_date, i.due_date, i.buyer ->> 'name' as buyer, i.buyer ->> 'gstin' as buyer_gstin, i.supply_type,
              i.place_of_supply, i.taxable_total, i.cgst_total, i.sgst_total, i.igst_total, i.delivery_charge, i.grand_total, i.status,
              ib.credited, ib.paid, ib.due
         from public.invoices i join public.invoice_balances ib on ib.invoice_id = i.id
        where i.wholesaler_id = $1 and i.invoice_date between $2 and $3 order by i.invoice_date, i.invoice_number`,
      [wholesalerId, p.from, p.to],
    ),
  );
}

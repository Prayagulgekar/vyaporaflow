import "server-only";
import { AppError } from "@/server/errors";
import { callFn, clampPage, pageOf, userTx, type Page } from "@/server/rpc";
import { uuid } from "@/server/validation";

export interface RetailerRow {
  relationship_id: string;
  retailer_id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  city: string | null;
  status: "pending" | "approved" | "rejected" | "blocked";
  credit_limit: string | null;
  request_note: string | null;
  total_orders: number;
  delivered_orders: number;
  cancelled_orders: number;
  invoiced: string;
  received: string;
  credited: string;
  outstanding: string;
  unapplied: string;
  last_order_at: Date | null;
  created_at: Date;
  total_count: number;
}

const SORTS: Record<string, string> = {
  name: "c.name asc",
  outstanding: "rb.outstanding desc, c.name",
  last_order: "rb.last_order_at desc nulls last",
  orders: "rb.total_orders desc",
};

export async function listRetailers(
  userId: string,
  wholesalerId: string,
  opts: { q?: string; status?: string; sort?: string; page?: unknown; pageSize?: number },
): Promise<Page<RetailerRow>> {
  const page = clampPage(opts.page);
  const size = opts.pageSize ?? 20;
  const order = SORTS[opts.sort ?? ""] ?? "(r.status = 'pending') desc, c.name";
  const status = ["pending", "approved", "rejected", "blocked"].includes(opts.status ?? "") ? opts.status : null;
  const rows = await userTx(userId, (q) =>
    q.query<RetailerRow>(
      `select r.id as relationship_id, r.retailer_id, c.name, c.contact_name, c.phone, a.city, r.status, r.credit_limit, r.request_note,
              rb.total_orders, rb.delivered_orders, rb.cancelled_orders, rb.invoiced, rb.received, rb.credited, rb.outstanding,
              rb.unapplied, rb.last_order_at, r.created_at, (count(*) over ())::int as total_count
         from public.retailer_wholesaler_relationships r
         join public.companies c on c.id = r.retailer_id
         left join public.business_addresses a on a.company_id = c.id and a.is_primary
         join public.retailer_balances rb on rb.wholesaler_id = r.wholesaler_id and rb.retailer_id = r.retailer_id
        where r.wholesaler_id = $1 and ($2::text is null or r.status::text = $2)
          and ($3::text is null or c.name ilike '%' || $3 || '%' or c.contact_name ilike '%' || $3 || '%' or c.phone like '%' || $3 || '%')
        order by ${order}
        limit $4 offset $5`,
      [wholesalerId, status, opts.q?.trim() || null, size, (page - 1) * size],
    ),
  );
  return pageOf(rows, page, size);
}

export async function decideRelationship(userId: string, relationshipId: string, decision: string, creditLimit: string | null, note: string | null) {
  uuid.parse(relationshipId);
  if (!["approved", "rejected", "blocked"].includes(decision)) throw new AppError("validation", "Choose approve, reject or block");
  if (creditLimit && !/^\d{1,10}(\.\d{1,2})?$/.test(creditLimit)) throw new AppError("validation", "Enter a valid credit limit");
  await userTx(userId, (q) => callFn(q, "decide_relationship", [relationshipId, decision, creditLimit || null, note || null]));
}

export async function requestRelationship(userId: string, retailerId: string, wholesalerId: string, note: string | null) {
  uuid.parse(retailerId);
  uuid.parse(wholesalerId);
  return userTx(userId, (q) => callFn<string>(q, "request_relationship", [retailerId, wholesalerId, note?.slice(0, 500) || null]));
}

export interface MyWholesalerRow {
  relationship_id: string;
  wholesaler_id: string;
  name: string;
  slug: string;
  phone: string | null;
  whatsapp_number: string | null;
  city: string | null;
  status: RetailerRow["status"];
  min_order_value: string | null;
  outstanding: string;
  invoiced: string;
  received: string;
  last_order_at: Date | null;
  product_count: number;
}

export async function listMyWholesalers(userId: string, retailerId: string) {
  return userTx(userId, (q) =>
    q.query<MyWholesalerRow>(
      `select r.id as relationship_id, r.wholesaler_id, c.name, c.slug, c.phone, wp.whatsapp_number, a.city, r.status,
              wp.min_order_value, rb.outstanding, rb.invoiced, rb.received, rb.last_order_at,
              (select count(*)::int from public.products p where p.company_id = r.wholesaler_id and p.archived_at is null) as product_count
         from public.retailer_wholesaler_relationships r
         join public.companies c on c.id = r.wholesaler_id
         left join public.wholesaler_profiles wp on wp.company_id = c.id
         left join public.business_addresses a on a.company_id = c.id and a.is_primary
         join public.retailer_balances rb on rb.wholesaler_id = r.wholesaler_id and rb.retailer_id = r.retailer_id
        where r.retailer_id = $1
        order by (r.status = 'approved') desc, c.name`,
      [retailerId],
    ),
  );
}

export async function relationshipFor(userId: string, retailerId: string, wholesalerId: string) {
  const rows = await userTx(userId, (q) =>
    q.query<{ id: string; status: RetailerRow["status"] }>(
      "select id, status from public.retailer_wholesaler_relationships where retailer_id = $1 and wholesaler_id = $2",
      [retailerId, wholesalerId],
    ),
  );
  return rows[0] ?? null;
}

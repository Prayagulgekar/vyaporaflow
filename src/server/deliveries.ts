import "server-only";
import { z } from "zod";
import { DELIVERY_STATUSES } from "@/domain/order-status";
import { AppError } from "@/server/errors";
import { callFn, clampPage, json, pageOf, userTx, type Page } from "@/server/rpc";
import { fieldErrors, optionalText, uuid } from "@/server/validation";

export interface DeliveryListRow {
  id: string;
  order_id: string;
  order_number: string;
  order_status: string;
  status: string;
  retailer_name: string;
  city: string;
  worker_id: string | null;
  worker_name: string | null;
  updated_at: Date;
  dispatched_at: Date | null;
  delivered_at: Date | null;
  failure_reason: string | null;
  total_count: number;
}

export async function listDeliveries(
  userId: string,
  wholesalerId: string,
  opts: { status?: string; worker?: string; page?: unknown; pageSize?: number },
): Promise<Page<DeliveryListRow>> {
  const page = clampPage(opts.page);
  const size = opts.pageSize ?? 20;
  const status = opts.status === "active" ? "active" : (DELIVERY_STATUSES as readonly string[]).includes(opts.status ?? "") ? opts.status : null;
  const rows = await userTx(userId, (q) =>
    q.query<DeliveryListRow>(
      `select d.id, d.order_id, o.order_number, o.status as order_status, d.status, rc.name as retailer_name,
              o.delivery_address ->> 'city' as city, d.assigned_worker_id as worker_id, p.full_name as worker_name,
              d.updated_at, d.dispatched_at, d.delivered_at, d.failure_reason, (count(*) over ())::int as total_count
         from public.deliveries d join public.orders o on o.id = d.order_id join public.companies rc on rc.id = o.retailer_id
         left join public.profiles p on p.id = d.assigned_worker_id
        where d.wholesaler_id = $1
          and ($2::text is null or ($2 = 'active' and d.status in ('assigned', 'out_for_delivery', 'failed')) or d.status::text = $2)
          and ($3::uuid is null or d.assigned_worker_id = $3)
        order by (d.status in ('assigned', 'out_for_delivery', 'failed')) desc, d.updated_at desc
        limit $4 offset $5`,
      [wholesalerId, status, opts.worker || null, size, (page - 1) * size],
    ),
  );
  return pageOf(rows, page, size);
}

/** Orders that can be assigned (accepted, preparing, ready) with no active assignment. */
export async function listUnassignedOrders(userId: string, wholesalerId: string) {
  return userTx(userId, (q) =>
    q.query<{ id: string; order_number: string; status: string; retailer_name: string; city: string; grand_total: string; placed_at: Date }>(
      `select o.id, o.order_number, o.status, o.retailer_name, o.delivery_address ->> 'city' as city, o.grand_total, o.placed_at
         from public.order_overview o
        where o.wholesaler_id = $1 and o.status in ('accepted', 'preparing', 'ready_for_delivery')
          and (o.delivery_id is null or o.delivery_status in ('failed', 'cancelled'))
        order by o.placed_at limit 50`,
      [wholesalerId],
    ),
  );
}

export async function listAssignableMembers(userId: string, wholesalerId: string) {
  return userTx(userId, (q) =>
    q.query<{ user_id: string; full_name: string; role: string; active_deliveries: number }>(
      `select m.user_id, coalesce(nullif(p.full_name, ''), p.email) as full_name, m.role,
              (select count(*)::int from public.deliveries d where d.assigned_worker_id = m.user_id and d.wholesaler_id = $1
                  and d.status in ('assigned', 'out_for_delivery')) as active_deliveries
         from public.company_memberships m join public.profiles p on p.id = m.user_id
        where m.company_id = $1 and m.status = 'active'
        order by (m.role = 'delivery_worker') desc, p.full_name`,
      [wholesalerId],
    ),
  );
}

export async function assignDelivery(userId: string, orderId: string, workerId: string, note?: string | null) {
  uuid.parse(orderId);
  uuid.parse(workerId);
  return userTx(userId, (q) => callFn<string>(q, "assign_delivery", [orderId, workerId, note?.slice(0, 500) || null]));
}

export interface MyDeliveryRow {
  id: string;
  order_id: string;
  order_number: string;
  order_status: string;
  status: string;
  delivery_address: { line1: string; line2?: string | null; city: string; pincode: string; state_code: string };
  items_count: number;
  grand_total: string;
  order_notes: string | null;
  retailer_name: string;
  retailer_phone: string | null;
  retailer_contact: string | null;
  wholesaler_name: string;
  notes: string | null;
  recipient_name: string | null;
  failure_reason: string | null;
  empties_collected: number | null;
  dispatched_at: Date | null;
  delivered_at: Date | null;
  updated_at: Date;
}

/** Only deliveries currently assigned to the signed-in user (enforced by RLS and the my_deliveries view). */
export async function listMyDeliveries(userId: string, scope: "active" | "completed") {
  return userTx(userId, (q) =>
    q.query<MyDeliveryRow>(
      `select * from public.my_deliveries
        where ($1 = 'active' and status in ('assigned', 'out_for_delivery'))
           or ($1 = 'completed' and status not in ('assigned', 'out_for_delivery'))
        order by case status when 'out_for_delivery' then 0 when 'assigned' then 1 else 2 end, updated_at desc
        limit 100`,
      [scope],
    ),
  );
}

export async function getMyDelivery(userId: string, deliveryId: string) {
  if (!uuid.safeParse(deliveryId).success) throw new AppError("not_found", "Delivery not found");
  const rows = await userTx(userId, (q) =>
    q.query<MyDeliveryRow & {
      items: { id: string; product_name: string; variant_name: string; quantity: string; unit_code: string; delivered_quantity: string | null }[];
      events: { id: number; from_status: string | null; to_status: string; note: string | null; actor_name: string | null; created_at: string }[];
      requires_empty_return: boolean;
    }>(
      `select md.*,
              coalesce((select jsonb_agg(jsonb_build_object('id', oi.id, 'product_name', oi.product_name, 'variant_name', oi.variant_name,
                   'quantity', oi.quantity::text, 'unit_code', oi.unit_code, 'delivered_quantity', oi.delivered_quantity::text) order by oi.line_no)
                 from public.order_items oi where oi.order_id = md.order_id), '[]') as items,
              coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'from_status', e.from_status, 'to_status', e.to_status, 'note', e.note,
                   'actor_name', p.full_name, 'created_at', e.created_at) order by e.id)
                 from public.delivery_events e left join public.profiles p on p.id = e.actor_id where e.delivery_id = md.id), '[]') as events,
              exists (select 1 from public.order_items oi join public.products pr on pr.id = oi.product_id
                       join public.product_categories pc on pc.id = pr.category_id
                      where oi.order_id = md.order_id and coalesce((pc.workflow_flags ->> 'requires_empty_return')::boolean, false)) as requires_empty_return
         from public.my_deliveries md where md.id = $1`,
      [deliveryId],
    ),
  );
  if (!rows[0]) throw new AppError("not_found", "Delivery not found or not assigned to you");
  return rows[0];
}

const updateSchema = z.object({
  delivery_id: uuid,
  to: z.enum(["out_for_delivery", "delivered", "partially_delivered", "failed"]),
  note: optionalText(1000),
  failure_reason: optionalText(500),
  recipient_name: optionalText(120),
  empties_collected: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.coerce.number().int().min(0).max(1000).optional()),
  items: z.array(z.object({ order_item_id: uuid, delivered_quantity: z.string().regex(/^\d{1,7}(\.\d{1,3})?$/) })).optional(),
});

export async function updateDelivery(userId: string, input: unknown) {
  const r = updateSchema.safeParse(input);
  if (!r.success) throw new AppError("validation", "Please correct the highlighted fields", fieldErrors(r.error));
  const d = r.data;
  await userTx(userId, (q) =>
    callFn(q, "update_delivery", [
      d.delivery_id,
      d.to,
      d.note ?? null,
      d.failure_reason ?? null,
      d.to === "partially_delivered" ? json(d.items ?? []) : null,
      d.recipient_name ?? null,
      d.empties_collected ?? null,
    ]),
  );
}

export async function deliveryHistory(userId: string, deliveryId: string) {
  return userTx(userId, (q) =>
    q.query<{ worker_name: string | null; assigned_by_name: string | null; assigned_at: Date; ended_at: Date | null; note: string | null }>(
      `select w.full_name as worker_name, b.full_name as assigned_by_name, a.assigned_at, a.ended_at, a.note
         from public.delivery_assignments a left join public.profiles w on w.id = a.worker_id left join public.profiles b on b.id = a.assigned_by
        where a.delivery_id = $1 order by a.assigned_at`,
      [deliveryId],
    ),
  );
}

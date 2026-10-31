import "server-only";
import { z } from "zod";
import { AppError } from "@/server/errors";
import { callFn, json, userTx } from "@/server/rpc";
import { fieldErrors, gstin, optionalEmail, optionalPhone, optionalText, uuid } from "@/server/validation";

export async function listSuppliers(userId: string, companyId: string) {
  return userTx(userId, (q) =>
    q.query<{ id: string; name: string; contact_name: string | null; phone: string | null; email: string | null; gstin: string | null; address: string | null; open_pos: number }>(
      `select s.id, s.name, s.contact_name, s.phone, s.email, s.gstin, s.address,
              (select count(*)::int from public.purchase_orders po where po.supplier_id = s.id and po.status in ('ordered', 'partially_received')) as open_pos
         from public.suppliers s where s.company_id = $1 and s.archived_at is null order by s.name`,
      [companyId],
    ),
  );
}

const supplierSchema = z.object({
  name: z.string().trim().min(2, "Enter the supplier name").max(120),
  contact_name: optionalText(120),
  phone: optionalPhone,
  email: optionalEmail,
  gstin,
  address: optionalText(300),
});

export async function createSupplier(userId: string, companyId: string, input: unknown) {
  const r = supplierSchema.safeParse(input);
  if (!r.success) throw new AppError("validation", "Please correct the highlighted fields", fieldErrors(r.error));
  const d = r.data;
  await userTx(userId, (q) =>
    q.query("insert into public.suppliers (company_id, name, contact_name, phone, email, gstin, address) values ($1, $2, $3, $4, $5, $6, $7)", [
      companyId,
      d.name,
      d.contact_name ?? null,
      d.phone ?? null,
      d.email ?? null,
      d.gstin ?? null,
      d.address ?? null,
    ]),
  );
}

export async function listPurchaseOrders(userId: string, companyId: string) {
  return userTx(userId, (q) =>
    q.query<{ id: string; po_number: string; supplier_name: string; status: string; expected_on: string | null; total_cost: string; created_at: Date; lines: number }>(
      `select po.id, po.po_number, s.name as supplier_name, po.status, po.expected_on::text, po.total_cost, po.created_at,
              (select count(*)::int from public.purchase_order_items i where i.purchase_order_id = po.id) as lines
         from public.purchase_orders po join public.suppliers s on s.id = po.supplier_id
        where po.company_id = $1 order by po.created_at desc limit 100`,
      [companyId],
    ),
  );
}

export async function getPurchaseOrder(userId: string, poId: string) {
  if (!uuid.safeParse(poId).success) throw new AppError("not_found", "Purchase order not found");
  const rows = await userTx(userId, (q) =>
    q.query<{ id: string; po_number: string; supplier_name: string; status: string; expected_on: string | null; notes: string | null; total_cost: string; created_at: Date;
      items: { id: string; product_name: string; variant_name: string; sku: string; base_unit: string; quantity: string; unit_cost: string; received_quantity: string; track_batches: boolean }[] }>(
      `select po.id, po.po_number, s.name as supplier_name, po.status, po.expected_on::text, po.notes, po.total_cost, po.created_at,
              coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'product_name', p.name, 'variant_name', v.name, 'sku', v.sku, 'base_unit', v.base_unit,
                  'quantity', i.quantity::text, 'unit_cost', i.unit_cost::text, 'received_quantity', i.received_quantity::text, 'track_batches', v.track_batches))
                 from public.purchase_order_items i join public.product_variants v on v.id = i.variant_id join public.products p on p.id = v.product_id
                where i.purchase_order_id = po.id), '[]') as items
         from public.purchase_orders po join public.suppliers s on s.id = po.supplier_id where po.id = $1`,
      [poId],
    ),
  );
  if (!rows[0]) throw new AppError("not_found", "Purchase order not found");
  return rows[0];
}

const poSchema = z.object({
  supplier_id: uuid,
  expected_on: z.preprocess((v) => (v === "" ? undefined : v), z.string().date().optional()),
  notes: optionalText(500),
  items: z
    .array(z.object({ variant_id: uuid, quantity: z.string().regex(/^\d{1,9}(\.\d{1,3})?$/), unit_cost: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/) }))
    .min(1, "Add at least one item"),
});

export async function createPurchaseOrder(userId: string, companyId: string, input: unknown) {
  const r = poSchema.safeParse(input);
  if (!r.success) throw new AppError("validation", "Please correct the purchase order", fieldErrors(r.error));
  const d = r.data;
  return userTx(userId, (q) => callFn<string>(q, "create_purchase_order", [companyId, d.supplier_id, json(d.items), d.expected_on ?? null, d.notes ?? null]));
}

export async function receiveGoods(userId: string, poId: string, items: { purchase_order_item_id: string; quantity: string; batch_no?: string; expiry_date?: string }[], note: string | null) {
  uuid.parse(poId);
  for (const it of items) {
    if (!/^\d{1,9}(\.\d{1,3})?$/.test(it.quantity)) throw new AppError("validation", "Received quantities must be numbers");
  }
  return userTx(userId, (q) => callFn<string>(q, "receive_goods", [poId, json(items), note]));
}

/** Low-stock replenishment suggestions: variants at or below threshold, with the quantity needed to reach twice the threshold. */
export async function replenishmentSuggestions(userId: string, companyId: string) {
  return userTx(userId, (q) =>
    q.query<{ variant_id: string; product_name: string; variant_name: string; sku: string; base_unit: string; available: string; low_stock_threshold: string; suggested: string }>(
      `select variant_id, product_name, variant_name, sku, base_unit, available, low_stock_threshold,
              greatest(low_stock_threshold * 2 - available, 0)::text as suggested
         from public.inventory_overview where company_id = $1 and is_low and archived_at is null order by product_name`,
      [companyId],
    ),
  );
}

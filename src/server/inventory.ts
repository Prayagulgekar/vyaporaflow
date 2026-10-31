import "server-only";
import { z } from "zod";
import { AppError } from "@/server/errors";
import { callFn, clampPage, pageOf, userTx, type Page } from "@/server/rpc";
import { fieldErrors, optionalText, uuid } from "@/server/validation";

export interface InventoryRow {
  variant_id: string;
  product_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  base_unit: string;
  category_name: string;
  brand_name: string | null;
  on_hand: string;
  reserved: string;
  available: string;
  low_stock_threshold: string;
  is_low: boolean;
  next_expiry: string | null;
  total_count: number;
}

export async function listInventory(
  userId: string,
  companyId: string,
  opts: { q?: string; filter?: string; page?: unknown; pageSize?: number },
): Promise<Page<InventoryRow>> {
  const page = clampPage(opts.page);
  const size = opts.pageSize ?? 20;
  const filter = ["low", "out", "expiring"].includes(opts.filter ?? "") ? opts.filter : "all";
  const rows = await userTx(userId, (q) =>
    q.query<InventoryRow>(
      `select io.variant_id, io.product_id, io.product_name, io.variant_name, io.sku, io.base_unit, io.category_name, io.brand_name,
              io.on_hand, io.reserved, io.available, io.low_stock_threshold, io.is_low, io.next_expiry::text,
              (count(*) over ())::int as total_count
         from public.inventory_overview io
        where io.company_id = $1 and io.archived_at is null
          and ($2::text is null or io.product_name ilike '%' || $2 || '%' or io.sku ilike '%' || $2 || '%')
          and ($3 = 'all' or ($3 = 'low' and io.is_low) or ($3 = 'out' and io.available <= 0)
               or ($3 = 'expiring' and io.next_expiry <= current_date + 30))
        order by io.is_low desc, io.product_name, io.variant_name
        limit $4 offset $5`,
      [companyId, opts.q?.trim() || null, filter, size, (page - 1) * size],
    ),
  );
  return pageOf(rows, page, size);
}

export const ADJUSTMENT_TYPES = {
  addition: "Stock received / added",
  return: "Customer return",
  reduction: "Stock removed",
  damage: "Damaged or expired (write-off)",
  adjustment: "Stock count correction (+/-)",
  purchase_return: "Returned to supplier",
} as const;

const adjustSchema = z.object({
  variant_id: uuid,
  movement_type: z.enum(Object.keys(ADJUSTMENT_TYPES) as [keyof typeof ADJUSTMENT_TYPES, ...(keyof typeof ADJUSTMENT_TYPES)[]]),
  quantity: z
    .string()
    .trim()
    .regex(/^-?\d{1,9}(\.\d{1,3})?$/, "Enter a quantity")
    .refine((v) => Number(v) !== 0, "Quantity cannot be zero"),
  note: z.string().trim().min(3, "Add a short note for the stock history").max(500),
  batch_no: optionalText(40),
  expiry_date: z.preprocess((v) => (v === "" ? undefined : v), z.string().date().optional()),
});

export async function adjustStock(userId: string, input: unknown) {
  const r = adjustSchema.safeParse(input);
  if (!r.success) throw new AppError("validation", "Please correct the highlighted fields", fieldErrors(r.error));
  const d = r.data;
  if (d.movement_type !== "adjustment" && Number(d.quantity) < 0) {
    throw new AppError("validation", "Enter a positive quantity; the movement type decides the direction", { quantity: ["Must be positive"] });
  }
  return userTx(userId, (q) =>
    callFn(q, "adjust_stock", [d.variant_id, d.movement_type, d.quantity, d.note, d.batch_no ?? null, d.expiry_date ?? null, null]),
  );
}

export interface MovementRow {
  id: number;
  created_at: Date;
  movement_type: string;
  product_name: string;
  variant_name: string;
  sku: string;
  base_unit: string;
  on_hand_delta: string;
  reserved_delta: string;
  on_hand_after: string;
  reserved_after: string;
  reference_type: string | null;
  reference_id: string | null;
  order_number: string | null;
  batch_no: string | null;
  note: string | null;
  actor_name: string | null;
  total_count: number;
}

export async function listMovements(
  userId: string,
  companyId: string,
  opts: { variantId?: string; type?: string; page?: unknown; pageSize?: number },
): Promise<Page<MovementRow>> {
  const page = clampPage(opts.page);
  const size = opts.pageSize ?? 25;
  const rows = await userTx(userId, (q) =>
    q.query<MovementRow>(
      `select m.id, m.created_at, m.movement_type, p.name as product_name, v.name as variant_name, v.sku, v.base_unit,
              m.on_hand_delta, m.reserved_delta, m.on_hand_after, m.reserved_after, m.reference_type, m.reference_id,
              o.order_number, b.batch_no, m.note, pr.full_name as actor_name, (count(*) over ())::int as total_count
         from public.stock_movements m
         join public.product_variants v on v.id = m.variant_id
         join public.products p on p.id = v.product_id
         left join public.orders o on m.reference_type = 'order' and o.id = m.reference_id
         left join public.product_batches b on b.id = m.batch_id
         left join public.profiles pr on pr.id = m.created_by
        where m.company_id = $1 and ($2::uuid is null or m.variant_id = $2)
          and ($3::text is null or m.movement_type::text = $3)
        order by m.id desc limit $4 offset $5`,
      [companyId, opts.variantId || null, opts.type || null, size, (page - 1) * size],
    ),
  );
  return pageOf(rows, page, size);
}

export async function reconcileInventory(userId: string, companyId: string) {
  return userTx(userId, (q) =>
    q.query<{ variant_id: string; on_hand: string; journal_on_hand: string; reserved: string; journal_reserved: string }>(
      "select * from app.reconcile_inventory($1) where on_hand <> journal_on_hand or reserved <> journal_reserved",
      [companyId],
    ),
  );
}

export async function listBatches(userId: string, companyId: string) {
  return userTx(userId, (q) =>
    q.query<{ id: string; batch_no: string; expiry_date: string | null; quantity_received: string; product_name: string; variant_name: string }>(
      `select b.id, b.batch_no, b.expiry_date::text, b.quantity_received, p.name as product_name, v.name as variant_name
         from public.product_batches b join public.product_variants v on v.id = b.variant_id join public.products p on p.id = v.product_id
        where b.company_id = $1 order by b.expiry_date nulls last limit 100`,
      [companyId],
    ),
  );
}

import "server-only";
import { z } from "zod";
import { AppError } from "@/server/errors";
import { anonTx, callFn, clampPage, json, pageOf, userTx, type Page } from "@/server/rpc";
import { fieldErrors, money, optionalText, percent, quantity, uuid } from "@/server/validation";
import type { Queryable } from "@/server/db";

export interface Category {
  id: string;
  company_id: string | null;
  name: string;
  slug: string;
  attribute_schema: { key: string; label: string; type: "text" | "number"; required?: boolean }[];
  workflow_flags: Record<string, boolean>;
}

export async function listCategories(companyId?: string) {
  return anonTx((q) =>
    q.query<Category>(
      `select id, company_id, name, slug, attribute_schema, workflow_flags from public.product_categories
        where is_active and (company_id is null or company_id = $1) order by sort_order, name`,
      [companyId ?? null],
    ),
  );
}

export async function listBrands(companyId?: string) {
  return anonTx((q) =>
    q.query<{ id: string; name: string; company_id: string | null }>(
      "select id, name, company_id from public.brands where company_id is null or company_id = $1 order by lower(name)",
      [companyId ?? null],
    ),
  );
}

export async function listUnits() {
  return anonTx((q) =>
    q.query<{ code: string; name: string; plural_name: string; dimension: string; base_factor: string | null; allows_fraction: boolean }>(
      "select code, name, plural_name, dimension, base_factor, allows_fraction from public.units_of_measure order by dimension, name",
    ),
  );
}

export async function listTaxClasses(companyId?: string) {
  return anonTx((q) =>
    q.query<{ id: string; name: string; rate: string }>(
      "select id, name, rate from public.tax_classes where is_active and (company_id is null or company_id = $1) order by rate, name",
      [companyId ?? null],
    ),
  );
}

export interface ProductListRow {
  id: string;
  name: string;
  category_name: string;
  brand_name: string | null;
  hsn_code: string | null;
  tax_rate: string;
  image_path: string | null;
  archived_at: Date | null;
  variant_count: number;
  min_price: string | null;
  max_price: string | null;
  available: string;
  low_count: number;
  total_count: number;
}

export async function listProducts(
  userId: string,
  companyId: string,
  opts: { q?: string; category?: string; status?: string; page?: unknown; pageSize?: number },
): Promise<Page<ProductListRow>> {
  const page = clampPage(opts.page);
  const size = opts.pageSize ?? 15;
  const status = opts.status === "archived" ? "archived" : opts.status === "all" ? "all" : "active";
  const rows = await userTx(userId, (q) =>
    q.query<ProductListRow>(
      `select p.id, p.name, pc.name as category_name, b.name as brand_name, p.hsn_code, tc.rate as tax_rate, p.image_path, p.archived_at,
              (select count(*)::int from public.product_variants v where v.product_id = p.id) as variant_count,
              (select min(vu.price) from public.variant_units vu join public.product_variants v on v.id = vu.variant_id where v.product_id = p.id and vu.is_active) as min_price,
              (select max(vu.price) from public.variant_units vu join public.product_variants v on v.id = vu.variant_id where v.product_id = p.id and vu.is_active) as max_price,
              coalesce((select sum(io.available) from public.inventory_overview io where io.product_id = p.id), 0) as available,
              (select count(*)::int from public.inventory_overview io where io.product_id = p.id and io.is_low) as low_count,
              (count(*) over ())::int as total_count
         from public.products p
         join public.product_categories pc on pc.id = p.category_id
         join public.tax_classes tc on tc.id = p.tax_class_id
         left join public.brands b on b.id = p.brand_id
        where p.company_id = $1
          and ($2::text is null or p.name ilike '%' || $2 || '%' or b.name ilike '%' || $2 || '%'
               or exists (select 1 from public.product_variants v where v.product_id = p.id and v.sku ilike '%' || $2 || '%'))
          and ($3::uuid is null or p.category_id = $3)
          and ($4 = 'all' or ($4 = 'active' and p.archived_at is null) or ($4 = 'archived' and p.archived_at is not null))
        order by p.name
        limit $5 offset $6`,
      [companyId, opts.q?.trim() || null, opts.category || null, status, size, (page - 1) * size],
    ),
  );
  return pageOf(rows, page, size);
}

export interface VariantUnit {
  id: string;
  unit_code: string;
  factor_to_base: string;
  price: string;
  mrp: string | null;
  discount_percent: string;
  min_order_qty: string;
  qty_step: string;
  is_default: boolean;
  is_active: boolean;
}

export interface ProductDetail {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  category_id: string;
  category_name: string;
  attribute_schema: Category["attribute_schema"];
  brand_id: string | null;
  brand_name: string | null;
  tax_class_id: string;
  tax_rate: string;
  hsn_code: string | null;
  price_includes_tax: boolean;
  attributes: Record<string, string | number>;
  image_path: string | null;
  archived_at: Date | null;
  variants: {
    id: string;
    name: string;
    sku: string;
    base_unit: string;
    barcode: string | null;
    low_stock_threshold: string;
    track_batches: boolean;
    is_active: boolean;
    on_hand: string;
    reserved: string;
    available: string;
    units: VariantUnit[];
  }[];
}

export async function getProduct(userId: string, productId: string): Promise<ProductDetail> {
  uuid.parse(productId);
  const rows = await userTx(userId, (q) =>
    q.query<ProductDetail>(
      `select p.id, p.company_id, p.name, p.description, p.category_id, pc.name as category_name, pc.attribute_schema,
              p.brand_id, b.name as brand_name, p.tax_class_id, tc.rate as tax_rate, p.hsn_code, p.price_includes_tax,
              p.attributes, p.image_path, p.archived_at,
              coalesce((select jsonb_agg(jsonb_build_object(
                  'id', v.id, 'name', v.name, 'sku', v.sku, 'base_unit', v.base_unit, 'barcode', v.barcode,
                  'low_stock_threshold', v.low_stock_threshold::text, 'track_batches', v.track_batches, 'is_active', v.is_active,
                  'on_hand', coalesce(io.on_hand, 0)::text, 'reserved', coalesce(io.reserved, 0)::text, 'available', coalesce(io.available, 0)::text,
                  'units', coalesce((select jsonb_agg(jsonb_build_object('id', vu.id, 'unit_code', vu.unit_code,
                      'factor_to_base', vu.factor_to_base::text, 'price', vu.price::text, 'mrp', vu.mrp::text,
                      'discount_percent', vu.discount_percent::text, 'min_order_qty', vu.min_order_qty::text,
                      'qty_step', vu.qty_step::text, 'is_default', vu.is_default, 'is_active', vu.is_active) order by vu.factor_to_base)
                    from public.variant_units vu where vu.variant_id = v.id), '[]'::jsonb)) order by v.name)
                from public.product_variants v left join public.inventory_overview io on io.variant_id = v.id
               where v.product_id = p.id), '[]'::jsonb) as variants
         from public.products p
         join public.product_categories pc on pc.id = p.category_id
         join public.tax_classes tc on tc.id = p.tax_class_id
         left join public.brands b on b.id = p.brand_id
        where p.id = $1`,
      [productId],
    ),
  );
  if (!rows[0]) throw new AppError("not_found", "Product not found");
  return rows[0];
}

// ---------------------------------------------------------------------------
// Create and edit
// ---------------------------------------------------------------------------
export const unitInputSchema = z.object({
  unit_code: z.string().regex(/^[a-z_]{1,20}$/, "Choose a unit"),
  factor_to_base: quantity,
  price: money,
  mrp: z.preprocess((v) => (v === "" ? undefined : v), money.optional()),
  discount_percent: z.preprocess((v) => (v === "" || v === undefined ? "0" : v), percent),
  min_order_qty: z.preprocess((v) => (v === "" || v === undefined ? "1" : v), quantity),
  qty_step: z.preprocess((v) => (v === "" || v === undefined ? "1" : v), quantity),
  is_default: z.boolean().default(false),
});

export const variantInputSchema = z.object({
  name: z.string().trim().min(1, "Enter the variant, e.g. 52 g").max(80),
  sku: z.string().trim().regex(/^[A-Za-z0-9._/-]{2,40}$/, "SKU: 2-40 letters, numbers, . _ / -"),
  base_unit: z.string().regex(/^[a-z_]{1,20}$/, "Choose the stock unit"),
  barcode: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^[0-9]{8,14}$/, "Barcode must be 8-14 digits").optional()),
  low_stock_threshold: z.preprocess((v) => (v === "" || v === undefined ? "0" : v), z.string().regex(/^\d{1,9}(\.\d{1,3})?$/)),
  track_batches: z.boolean().default(false),
  opening_stock: z.preprocess((v) => (v === "" || v === undefined ? "0" : v), z.string().regex(/^\d{1,9}(\.\d{1,3})?$/, "Enter a stock quantity")),
  batch_no: optionalText(40),
  expiry_date: z.preprocess((v) => (v === "" ? undefined : v), z.string().date().optional()),
  units: z.array(unitInputSchema).min(1, "Add at least one selling unit").max(6),
});

export const productInputSchema = z.object({
  name: z.string().trim().min(2, "Enter the product name").max(160),
  description: optionalText(2000),
  category_id: uuid,
  brand_id: z.preprocess((v) => (v === "" ? undefined : v), uuid.optional()),
  new_brand: optionalText(80),
  tax_class_id: uuid,
  hsn_code: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^[0-9]{4,8}$/, "HSN code has 4-8 digits").optional()),
  price_includes_tax: z.boolean().default(false),
  attributes: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
});

export type ProductInput = z.input<typeof productInputSchema>;
export type VariantInput = z.input<typeof variantInputSchema>;

function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new AppError("validation", "Please correct the highlighted fields", fieldErrors(r.error));
  return r.data;
}

async function validateAttributes(q: Queryable, categoryId: string, attrs: Record<string, string | number>) {
  const [cat] = await q.query<{ attribute_schema: Category["attribute_schema"] }>(
    "select attribute_schema from public.product_categories where id = $1",
    [categoryId],
  );
  if (!cat) throw new AppError("validation", "Choose a category");
  const out: Record<string, string | number> = {};
  for (const def of cat.attribute_schema) {
    const raw = attrs[def.key];
    const empty = raw === undefined || raw === "";
    if (empty) {
      if (def.required) throw new AppError("validation", `${def.label} is required for this category`, { [`attributes.${def.key}`]: ["Required"] });
      continue;
    }
    if (def.type === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) throw new AppError("validation", `${def.label} must be a number`);
      out[def.key] = n;
    } else {
      out[def.key] = String(raw).slice(0, 200);
    }
  }
  return out;
}

async function resolveBrand(q: Queryable, companyId: string, brandId?: string, newBrand?: string): Promise<string | null> {
  if (newBrand) {
    const existing = await q.query<{ id: string }>(
      "select id from public.brands where lower(name) = lower($2) and (company_id is null or company_id = $1) limit 1",
      [companyId, newBrand],
    );
    if (existing[0]) return existing[0].id;
    const r = await q.query<{ id: string }>("insert into public.brands (company_id, name) values ($1, $2) returning id", [companyId, newBrand]);
    return r[0]!.id;
  }
  return brandId ?? null;
}

function checkUnits(v: z.infer<typeof variantInputSchema>) {
  const rowOf = new Map<string, number>();
  v.units.forEach((u, i) => {
    const first = rowOf.get(u.unit_code);
    if (first !== undefined) {
      throw new AppError("validation", "Each selling unit can be added once per variant", {
        [`units.${i}.unit_code`]: ["Already used in another row. Choose a different unit or leave this row as Not used."],
      });
    }
    rowOf.set(u.unit_code, i);
  });
  const baseIndex = v.units.findIndex((u) => u.unit_code === v.base_unit);
  if (baseIndex >= 0 && Number(v.units[baseIndex]!.factor_to_base) !== 1) {
    const unit = v.base_unit;
    throw new AppError("validation", `Pack size must be 1 when you sell by the ${unit}, because stock is counted in ${unit}s`, {
      [`units.${baseIndex}.factor_to_base`]: [
        `Must be 1: stock is counted in ${unit}s, so one ${unit} is one ${unit}. To sell packs of several items, count stock in the smaller unit (for example packets) and set the pack size on the ${unit} row.`,
      ],
    });
  }
  if (!v.units.some((u) => u.is_default)) v.units[0]!.is_default = true;
  let seen = false;
  for (const u of v.units) {
    if (u.is_default && seen) u.is_default = false;
    if (u.is_default) seen = true;
  }
}

async function insertVariant(q: Queryable, companyId: string, productId: string, v: z.infer<typeof variantInputSchema>) {
  checkUnits(v);
  const [row] = await q.query<{ id: string }>(
    `insert into public.product_variants (product_id, company_id, name, sku, base_unit, barcode, low_stock_threshold, track_batches)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [productId, companyId, v.name, v.sku.toUpperCase(), v.base_unit, v.barcode ?? null, v.low_stock_threshold, v.track_batches],
  );
  const variantId = row!.id;
  for (const u of v.units) {
    await q.query(
      `insert into public.variant_units (variant_id, company_id, unit_code, factor_to_base, price, mrp, discount_percent, min_order_qty, qty_step, is_default)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [variantId, companyId, u.unit_code, u.factor_to_base, u.price, u.mrp ?? null, u.discount_percent, u.min_order_qty, u.qty_step, u.is_default],
    );
  }
  if (Number(v.opening_stock) > 0) {
    await callFn(q, "adjust_stock", [variantId, "opening", v.opening_stock, "Opening stock", v.batch_no ?? null, v.expiry_date ?? null, null]);
  }
  return variantId;
}

/** Create a product with its first variant, selling units and opening stock in one transaction (RLS applies). */
export async function createProduct(userId: string, companyId: string, productInput: unknown, variantInput: unknown): Promise<string> {
  const p = parse(productInputSchema, productInput);
  const v = parse(variantInputSchema, variantInput);
  return userTx(userId, async (q) => {
    const attrs = await validateAttributes(q, p.category_id, p.attributes);
    const brandId = await resolveBrand(q, companyId, p.brand_id, p.new_brand);
    const [row] = await q.query<{ id: string }>(
      `insert into public.products (company_id, category_id, brand_id, tax_class_id, name, description, hsn_code, price_includes_tax, attributes, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, auth.uid()) returning id`,
      [companyId, p.category_id, brandId, p.tax_class_id, p.name, p.description ?? null, p.hsn_code ?? null, p.price_includes_tax, json(attrs)],
    );
    await insertVariant(q, companyId, row!.id, v);
    return row!.id;
  });
}

export async function updateProduct(userId: string, productId: string, productInput: unknown) {
  const p = parse(productInputSchema, productInput);
  await userTx(userId, async (q) => {
    const [cur] = await q.query<{ company_id: string }>("select company_id from public.products where id = $1", [productId]);
    if (!cur) throw new AppError("not_found", "Product not found");
    const attrs = await validateAttributes(q, p.category_id, p.attributes);
    const brandId = await resolveBrand(q, cur.company_id, p.brand_id, p.new_brand);
    const r = await q.query(
      `update public.products set name = $2, description = $3, category_id = $4, brand_id = $5, tax_class_id = $6,
              hsn_code = $7, price_includes_tax = $8, attributes = $9 where id = $1 returning id`,
      [productId, p.name, p.description ?? null, p.category_id, brandId, p.tax_class_id, p.hsn_code ?? null, p.price_includes_tax, json(attrs)],
    );
    if (!r.length) throw new AppError("forbidden", "Only owners and managers can edit products");
  });
}

export async function addVariant(userId: string, productId: string, variantInput: unknown) {
  const v = parse(variantInputSchema, variantInput);
  return userTx(userId, async (q) => {
    const [cur] = await q.query<{ company_id: string }>("select company_id from public.products where id = $1", [productId]);
    if (!cur) throw new AppError("not_found", "Product not found");
    return insertVariant(q, cur.company_id, productId, v);
  });
}

export async function setArchived(userId: string, productId: string, archived: boolean) {
  await userTx(userId, async (q) => {
    const r = await q.query(
      `update public.products set archived_at = case when $2 then coalesce(archived_at, now()) end where id = $1 returning id`,
      [productId, archived],
    );
    if (!r.length) throw new AppError("forbidden", "Only owners and managers can archive products");
  });
}

export async function setProductImage(userId: string, productId: string, path: string | null) {
  await userTx(userId, async (q) => {
    const r = await q.query("update public.products set image_path = $2 where id = $1 returning id", [productId, path]);
    if (!r.length) throw new AppError("forbidden", "Only owners and managers can change product images");
  });
}

const unitUpdateSchema = unitInputSchema.extend({ is_active: z.boolean() });

export async function upsertVariantUnit(userId: string, variantId: string, input: unknown, unitId?: string) {
  const u = parse(unitUpdateSchema, input);
  await userTx(userId, async (q) => {
    const [v] = await q.query<{ company_id: string; base_unit: string }>(
      "select company_id, base_unit from public.product_variants where id = $1",
      [variantId],
    );
    if (!v) throw new AppError("not_found", "Variant not found");
    if (u.unit_code === v.base_unit && Number(u.factor_to_base) !== 1) {
      throw new AppError("validation", `Pack size must be 1 when you sell by the ${v.base_unit}, because stock is counted in ${v.base_unit}s`, {
        factor_to_base: [`Must be 1: stock is counted in ${v.base_unit}s. To sell packs of several items, add a different selling unit (for example box) with its pack size.`],
      });
    }
    if (u.is_default) await q.query("update public.variant_units set is_default = false where variant_id = $1", [variantId]);
    if (unitId) {
      const r = await q.query(
        `update public.variant_units set unit_code = $3, factor_to_base = $4, price = $5, mrp = $6, discount_percent = $7,
                min_order_qty = $8, qty_step = $9, is_default = $10, is_active = $11
          where id = $1 and variant_id = $2 returning id`,
        [unitId, variantId, u.unit_code, u.factor_to_base, u.price, u.mrp ?? null, u.discount_percent, u.min_order_qty, u.qty_step, u.is_default, u.is_active],
      );
      if (!r.length) throw new AppError("forbidden", "Only owners and managers can change prices");
    } else {
      await q.query(
        `insert into public.variant_units (variant_id, company_id, unit_code, factor_to_base, price, mrp, discount_percent, min_order_qty, qty_step, is_default, is_active)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [variantId, v.company_id, u.unit_code, u.factor_to_base, u.price, u.mrp ?? null, u.discount_percent, u.min_order_qty, u.qty_step, u.is_default, u.is_active],
      );
    }
  });
}

const variantUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  low_stock_threshold: z.string().regex(/^\d{1,9}(\.\d{1,3})?$/),
  is_active: z.boolean(),
  track_batches: z.boolean(),
});

export async function updateVariant(userId: string, variantId: string, input: unknown) {
  const d = parse(variantUpdateSchema, input);
  await userTx(userId, async (q) => {
    const r = await q.query(
      "update public.product_variants set name = $2, low_stock_threshold = $3, is_active = $4, track_batches = $5 where id = $1 returning id",
      [variantId, d.name, d.low_stock_threshold, d.is_active, d.track_batches],
    );
    if (!r.length) throw new AppError("forbidden", "Only owners and managers can edit variants");
  });
}

export async function createCategory(userId: string, companyId: string, name: string) {
  const n = z.string().trim().min(2).max(80).parse(name);
  const slug = n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "category";
  await userTx(userId, (q) =>
    q.query("insert into public.product_categories (company_id, name, slug, sort_order) values ($1, $2, $3, 500)", [companyId, n, slug]),
  );
}

export async function createBrand(userId: string, companyId: string, name: string) {
  const n = z.string().trim().min(1).max(80).parse(name);
  await userTx(userId, (q) => q.query("insert into public.brands (company_id, name) values ($1, $2)", [companyId, n]));
}

// ---------------------------------------------------------------------------
// Spreadsheet export / import (CSV, opens in Excel, LibreOffice and Google Sheets)
// ---------------------------------------------------------------------------
export const PRODUCT_CSV_HEADERS = [
  "product_name",
  "category_slug",
  "brand",
  "gst_rate",
  "hsn_code",
  "price_includes_tax",
  "variant_name",
  "sku",
  "stock_unit",
  "sale_unit",
  "units_per_sale_unit",
  "price",
  "mrp",
  "discount_percent",
  "min_order_qty",
  "opening_stock",
] as const;

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export async function exportProductsCsv(userId: string, companyId: string): Promise<string> {
  const rows = await userTx(userId, (q) =>
    q.query<Record<string, unknown>>(
      `select p.name as product_name, pc.slug as category_slug, b.name as brand, tc.rate as gst_rate, p.hsn_code,
              p.price_includes_tax, v.name as variant_name, v.sku, v.base_unit as stock_unit, vu.unit_code as sale_unit,
              vu.factor_to_base as units_per_sale_unit, vu.price, vu.mrp, vu.discount_percent, vu.min_order_qty,
              io.on_hand as opening_stock
         from public.products p
         join public.product_categories pc on pc.id = p.category_id
         join public.tax_classes tc on tc.id = p.tax_class_id
         left join public.brands b on b.id = p.brand_id
         join public.product_variants v on v.product_id = p.id
         join public.variant_units vu on vu.variant_id = v.id
         left join public.inventory_overview io on io.variant_id = v.id
        where p.company_id = $1 and p.archived_at is null
        order by p.name, v.name, vu.factor_to_base`,
      [companyId],
    ),
  );
  const lines = [PRODUCT_CSV_HEADERS.join(",")];
  for (const r of rows) lines.push(PRODUCT_CSV_HEADERS.map((h) => csvEscape(r[h])).join(","));
  return lines.join("\n") + "\n";
}

/**
 * Import products from CSV (same columns as the export). Rows sharing a SKU
 * become one variant with several selling units. Existing SKUs are skipped.
 * All-or-nothing: any invalid row aborts the import with its row number.
 */
export async function importProductsCsv(userId: string, companyId: string, text: string) {
  const table = parseCsv(text.replace(/^﻿/, ""));
  if (table.length < 2) throw new AppError("validation", "The file has no data rows");
  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const missing = PRODUCT_CSV_HEADERS.filter((h) => !["mrp", "discount_percent", "brand", "hsn_code"].includes(h) && !header.includes(h));
  if (missing.length) throw new AppError("validation", `Missing columns: ${missing.join(", ")}`);
  if (table.length > 1001) throw new AppError("validation", "Import at most 1000 rows at a time");
  const get = (row: string[], key: string) => (row[header.indexOf(key)] ?? "").trim();

  type Group = { rowNo: number; product: ProductInput; variant: VariantInput; gstRate: string; categorySlug: string };
  const groups = new Map<string, Group>();
  table.slice(1).forEach((row, i) => {
    const rowNo = i + 2;
    const sku = get(row, "sku").toUpperCase();
    if (!sku) throw new AppError("validation", `Row ${rowNo}: sku is required`);
    const unit = {
      unit_code: get(row, "sale_unit"),
      factor_to_base: get(row, "units_per_sale_unit") || "1",
      price: get(row, "price"),
      mrp: get(row, "mrp"),
      discount_percent: get(row, "discount_percent") || "0",
      min_order_qty: get(row, "min_order_qty") || "1",
      qty_step: "1",
      is_default: false,
    };
    const g = groups.get(sku);
    if (g) {
      (g.variant.units as unknown[]).push(unit);
      return;
    }
    groups.set(sku, {
      rowNo,
      gstRate: get(row, "gst_rate"),
      categorySlug: get(row, "category_slug"),
      product: {
        name: get(row, "product_name"),
        category_id: "00000000-0000-4000-8000-000000000000",
        tax_class_id: "00000000-0000-4000-8000-000000000000",
        new_brand: get(row, "brand") || undefined,
        hsn_code: get(row, "hsn_code") || undefined,
        price_includes_tax: ["true", "yes", "1"].includes(get(row, "price_includes_tax").toLowerCase()),
        attributes: {},
      },
      variant: {
        name: get(row, "variant_name") || "Standard",
        sku,
        base_unit: get(row, "stock_unit"),
        low_stock_threshold: "0",
        opening_stock: get(row, "opening_stock") || "0",
        units: [unit],
      },
    });
  });

  return userTx(userId, async (q) => {
    let created = 0;
    let skipped = 0;
    for (const g of groups.values()) {
      const [cat] = await q.query<{ id: string }>(
        "select id from public.product_categories where slug = $2 and (company_id is null or company_id = $1) order by company_id nulls last limit 1",
        [companyId, g.categorySlug],
      );
      const [tax] = await q.query<{ id: string }>(
        "select id from public.tax_classes where rate = $2::numeric and (company_id is null or company_id = $1) order by company_id nulls last, name limit 1",
        [companyId, g.gstRate || "-1"],
      );
      if (!cat) throw new AppError("validation", `Row ${g.rowNo}: unknown category_slug "${g.categorySlug}"`);
      if (!tax) throw new AppError("validation", `Row ${g.rowNo}: no tax class with GST rate ${g.gstRate}%`);
      const exists = await q.query("select 1 from public.product_variants where company_id = $1 and sku = $2", [companyId, g.variant.sku]);
      if (exists.length) {
        skipped++;
        continue;
      }
      const pr = productInputSchema.safeParse({ ...g.product, category_id: cat.id, tax_class_id: tax.id });
      const vr = variantInputSchema.safeParse(g.variant);
      if (!pr.success || !vr.success) {
        const issue = (pr.success ? undefined : pr.error.issues[0]) ?? (vr.success ? undefined : vr.error.issues[0]);
        throw new AppError("validation", `Row ${g.rowNo}: ${issue?.path.join(".")} ${issue?.message}`);
      }
      const brandId = await resolveBrand(q, companyId, undefined, pr.data.new_brand);
      const [row] = await q.query<{ id: string }>(
        `insert into public.products (company_id, category_id, brand_id, tax_class_id, name, hsn_code, price_includes_tax, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, auth.uid()) returning id`,
        [companyId, cat.id, brandId, tax.id, pr.data.name, pr.data.hsn_code ?? null, pr.data.price_includes_tax],
      );
      try {
        await insertVariant(q, companyId, row!.id, vr.data);
      } catch (err) {
        const e = err as { message?: string };
        throw new AppError("validation", `Row ${g.rowNo}: ${e.message ?? "invalid values"}`);
      }
      created++;
    }
    return { created, skipped };
  });
}

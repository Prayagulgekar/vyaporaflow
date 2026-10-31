import "server-only";
import { AppError } from "@/server/errors";
import { userTx } from "@/server/rpc";
import { quoteOrder, type Quote } from "@/server/orders";
import { uuid } from "@/server/validation";

export interface CartGroup {
  wholesaler_id: string;
  wholesaler_name: string;
  wholesaler_slug: string;
  items: { variant_unit_id: string; quantity: string }[];
  quote: Quote | null;
  quoteError: string | null;
}

/** The retailer's carts, one per wholesaler, each priced by the server. */
export async function getCarts(userId: string, retailerId: string): Promise<CartGroup[]> {
  const rows = await userTx(userId, (q) =>
    q.query<{ wholesaler_id: string; name: string; slug: string; variant_unit_id: string; quantity: string }>(
      `select ci.wholesaler_id, c.name, c.slug, ci.variant_unit_id, ci.quantity
         from public.cart_items ci join public.companies c on c.id = ci.wholesaler_id
        where ci.retailer_id = $1 order by c.name, ci.updated_at`,
      [retailerId],
    ),
  );
  const groups = new Map<string, CartGroup>();
  for (const r of rows) {
    let g = groups.get(r.wholesaler_id);
    if (!g) {
      g = { wholesaler_id: r.wholesaler_id, wholesaler_name: r.name, wholesaler_slug: r.slug, items: [], quote: null, quoteError: null };
      groups.set(r.wholesaler_id, g);
    }
    g.items.push({ variant_unit_id: r.variant_unit_id, quantity: r.quantity });
  }
  for (const g of groups.values()) {
    try {
      g.quote = await quoteOrder(userId, retailerId, g.wholesaler_id, g.items);
    } catch (err) {
      g.quoteError = err instanceof AppError ? err.message : "Could not price this cart";
    }
  }
  return [...groups.values()];
}

export async function cartCount(userId: string, retailerId: string): Promise<number> {
  const rows = await userTx(userId, (q) =>
    q.query<{ n: number }>("select count(*)::int as n from public.cart_items where retailer_id = $1", [retailerId]),
  );
  return rows[0]?.n ?? 0;
}

export async function setCartQuantity(userId: string, retailerId: string, variantUnitId: string, quantity: string) {
  uuid.parse(variantUnitId);
  if (!/^\d{1,7}(\.\d{1,3})?$/.test(quantity)) throw new AppError("validation", "Enter a valid quantity");
  await userTx(userId, async (q) => {
    if (Number(quantity) === 0) {
      await q.query("delete from public.cart_items where retailer_id = $1 and variant_unit_id = $2", [retailerId, variantUnitId]);
      return;
    }
    const [vu] = await q.query<{ company_id: string }>("select company_id from public.variant_units where id = $1 and is_active", [variantUnitId]);
    if (!vu) throw new AppError("forbidden", "This product is not available to your shop");
    await q.query(
      `insert into public.cart_items (retailer_id, wholesaler_id, variant_unit_id, quantity, added_by)
       values ($1, $2, $3, $4, auth.uid())
       on conflict (retailer_id, variant_unit_id) do update set quantity = excluded.quantity`,
      [retailerId, vu.company_id, variantUnitId, quantity],
    );
  });
}

export async function clearCart(userId: string, retailerId: string, wholesalerId: string) {
  await userTx(userId, (q) =>
    q.query("delete from public.cart_items where retailer_id = $1 and wholesaler_id = $2", [retailerId, wholesalerId]),
  );
}

export interface CatalogItem {
  product_id: string;
  product_name: string;
  description: string | null;
  image_path: string | null;
  category_name: string;
  category_slug: string;
  brand_name: string | null;
  price_includes_tax: boolean;
  tax_rate: string;
  variants: {
    id: string;
    name: string;
    base_unit: string;
    availability: "in_stock" | "low_stock" | "out_of_stock";
    units: {
      id: string;
      unit_code: string;
      factor_to_base: string;
      price: string;
      mrp: string | null;
      discount_percent: string;
      min_order_qty: string;
      qty_step: string;
      is_default: boolean;
      in_cart: string | null;
    }[];
  }[];
}

/** Catalog of an approved wholesaler as the retailer sees it (RLS limits rows to approved relationships). */
export async function getCatalog(
  userId: string,
  retailerId: string,
  wholesalerId: string,
  opts: { q?: string; category?: string },
): Promise<CatalogItem[]> {
  return userTx(userId, (q) =>
    q.query<CatalogItem>(
      `select p.id as product_id, p.name as product_name, p.description, p.image_path, pc.name as category_name, pc.slug as category_slug,
              b.name as brand_name, p.price_includes_tax, tc.rate as tax_rate,
              (select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'base_unit', v.base_unit,
                   'availability', coalesce((select va.availability from app.variant_availability(array[v.id]) va), 'out_of_stock'),
                   'units', (select jsonb_agg(jsonb_build_object('id', vu.id, 'unit_code', vu.unit_code, 'factor_to_base', vu.factor_to_base::text,
                        'price', vu.price::text, 'mrp', vu.mrp::text, 'discount_percent', vu.discount_percent::text,
                        'min_order_qty', vu.min_order_qty::text, 'qty_step', vu.qty_step::text, 'is_default', vu.is_default,
                        'in_cart', (select ci.quantity::text from public.cart_items ci where ci.retailer_id = $2 and ci.variant_unit_id = vu.id))
                        order by vu.factor_to_base) from public.variant_units vu where vu.variant_id = v.id and vu.is_active))
                 order by v.name) from public.product_variants v where v.product_id = p.id and v.is_active) as variants
         from public.products p
         join public.product_categories pc on pc.id = p.category_id
         join public.tax_classes tc on tc.id = p.tax_class_id
         left join public.brands b on b.id = p.brand_id
        where p.company_id = $1 and p.archived_at is null
          and ($3::text is null or p.name ilike '%' || $3 || '%' or b.name ilike '%' || $3 || '%' or pc.name ilike '%' || $3 || '%')
          and ($4::text is null or pc.slug = $4)
        order by pc.sort_order, pc.name, p.name`,
      [wholesalerId, retailerId, opts.q?.trim() || null, opts.category || null],
    ),
  ).then((rows) => rows.filter((r) => Array.isArray(r.variants) && r.variants.some((v) => v.units?.length)));
}

/** Product search across every wholesaler that approved this retailer. */
export async function searchApprovedProducts(userId: string, retailerId: string, q: string, category?: string) {
  return userTx(userId, (tx) =>
    tx.query<{ product_id: string; product_name: string; brand_name: string | null; category_name: string; wholesaler_id: string; wholesaler_name: string; from_price: string | null; unit_code: string | null }>(
      `select p.id as product_id, p.name as product_name, b.name as brand_name, pc.name as category_name,
              c.id as wholesaler_id, c.name as wholesaler_name,
              (select vu.price::text from public.variant_units vu join public.product_variants v on v.id = vu.variant_id
                where v.product_id = p.id and vu.is_active order by vu.is_default desc, vu.price limit 1) as from_price,
              (select vu.unit_code from public.variant_units vu join public.product_variants v on v.id = vu.variant_id
                where v.product_id = p.id and vu.is_active order by vu.is_default desc, vu.price limit 1) as unit_code
         from public.products p
         join public.companies c on c.id = p.company_id
         join public.product_categories pc on pc.id = p.category_id
         left join public.brands b on b.id = p.brand_id
        where p.archived_at is null
          and p.company_id in (select wholesaler_id from public.retailer_wholesaler_relationships where retailer_id = $1 and status = 'approved')
          and ($2::text is null or p.name ilike '%' || $2 || '%' or b.name ilike '%' || $2 || '%' or pc.name ilike '%' || $2 || '%')
          and ($3::text is null or pc.slug = $3)
        order by p.name, c.name limit 100`,
      [retailerId, q.trim() || null, category || null],
    ),
  );
}

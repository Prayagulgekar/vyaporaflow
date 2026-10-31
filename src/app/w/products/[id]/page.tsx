import Link from "next/link";
import { Badge, Card, Checkbox, Money, Notice, PageHeader } from "@/components/ui";
import { ActionForm, ConfirmSubmit, SelectField, SubmitButton, TextField } from "@/components/ui/client";
import { orNotFound } from "@/features/shared/util";
import { addVariantAction, archiveProductAction, saveUnitAction, updateProductAction, updateVariantAction } from "@/features/wholesaler/actions";
import { ProductForm, VariantFields } from "@/features/wholesaler/product-form";
import { formatQuantity } from "@/lib/format";
import { getProduct, listBrands, listCategories, listTaxClasses, listUnits } from "@/server/catalog";
import { imageUrl } from "@/server/storage";
import { requireWholesaler } from "@/server/viewer";

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { id } = await params;
  const { created } = await searchParams;
  const { viewer, company } = await requireWholesaler();
  const product = await orNotFound(getProduct(viewer.userId, id));
  const [categories, brands, taxClasses, units] = await Promise.all([listCategories(company.companyId), listBrands(company.companyId), listTaxClasses(company.companyId), listUnits()]);
  const img = imageUrl(product.image_path);
  const manager = company.role === "owner" || company.role === "manager";
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/w/products" className="link">Products</Link>}
        title={product.name}
        description={`${product.category_name}${product.brand_name ? ` · ${product.brand_name}` : ""} · GST ${Number(product.tax_rate)}%`}
        actions={
          manager ? (
            <ActionForm action={archiveProductAction}>
              <input type="hidden" name="product_id" value={product.id} />
              <input type="hidden" name="archive" value={product.archived_at ? "0" : "1"} />
              {product.archived_at ? (
                <SubmitButton variant="secondary">Restore product</SubmitButton>
              ) : (
                <ConfirmSubmit label="Archive" variant="secondary" title="Archive this product?" body="Retailers will no longer see it. Past orders and invoices are not affected. You can restore it later." confirmLabel="Archive" />
              )}
            </ActionForm>
          ) : null
        }
      />
      {created ? <div className="mb-4"><Notice tone="ok">Product saved. Add more variants or selling units below.</Notice></div> : null}
      {product.archived_at ? <div className="mb-4"><Notice tone="warn">This product is archived and hidden from retailers.</Notice></div> : null}

      <h2 className="mb-3 text-lg font-semibold">Variants, stock and prices</h2>
      <div className="space-y-4">
        {product.variants.map((v) => (
          <Card
            key={v.id}
            title={
              <span>
                {v.name} <span className="font-normal text-ink-muted">· {v.sku}</span> {v.is_active ? null : <Badge>Inactive</Badge>}
              </span>
            }
            actions={<Link href={`/w/inventory?q=${encodeURIComponent(v.sku)}`} className="link text-sm">Stock history</Link>}
          >
            <p className="text-sm">
              On hand <strong>{formatQuantity(v.on_hand, v.base_unit)}</strong> · reserved for orders {formatQuantity(v.reserved, v.base_unit)} · available{" "}
              <strong>{formatQuantity(v.available, v.base_unit)}</strong>
              {Number(v.available) <= Number(v.low_stock_threshold) && Number(v.low_stock_threshold) > 0 ? <span className="ml-2"><Badge tone="warn">Low stock</Badge></span> : null}
            </p>
            <table className="data-table stack mt-3">
              <thead>
                <tr>
                  <th scope="col">Sold by</th>
                  <th scope="col" className="num">Pack size</th>
                  <th scope="col" className="num">Price</th>
                  <th scope="col" className="num">MRP</th>
                  <th scope="col" className="num">Discount</th>
                  <th scope="col" className="num">Min. order</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {v.units.map((u) => (
                  <tr key={u.id}>
                    <td data-label="Sold by">{u.unit_code}{u.is_default ? <span className="ml-1 text-xs text-ink-muted">(default)</span> : null}</td>
                    <td data-label="Pack size" className="num">{formatQuantity(u.factor_to_base, v.base_unit)}</td>
                    <td data-label="Price" className="num"><Money value={u.price} /></td>
                    <td data-label="MRP" className="num">{u.mrp ? <Money value={u.mrp} /> : "–"}</td>
                    <td data-label="Discount" className="num">{Number(u.discount_percent)}%</td>
                    <td data-label="Min. order" className="num">{formatQuantity(u.min_order_qty, u.unit_code)}</td>
                    <td data-label="Status">{u.is_active ? <Badge tone="ok">Selling</Badge> : <Badge>Off</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {manager ? (
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <details className="rounded-md border border-line p-3">
                  <summary className="cursor-pointer text-sm font-medium">Change a price or add a selling unit</summary>
                  <ActionForm action={saveUnitAction} className="mt-3 grid grid-cols-2 gap-3">
                    <input type="hidden" name="variant_id" value={v.id} />
                    <input type="hidden" name="product_id" value={product.id} />
                    <div className="col-span-2">
                      <SelectField name="unit_id" label="Selling unit" defaultValue="">
                        <option value="">Add a new selling unit</option>
                        {v.units.map((u) => <option key={u.id} value={u.id}>Edit: {u.unit_code} of {formatQuantity(u.factor_to_base, v.base_unit)}</option>)}
                      </SelectField>
                    </div>
                    <SelectField name="unit_code" label="Sold by" defaultValue={v.units[0]?.unit_code}>
                      {units.map((u) => <option key={u.code} value={u.code}>{u.name}</option>)}
                    </SelectField>
                    <TextField name="factor_to_base" label={`Pack size (${v.base_unit})`} inputMode="decimal" defaultValue="1" />
                    <TextField name="price" label="Price (₹)" inputMode="decimal" required />
                    <TextField name="mrp" label="MRP (₹)" inputMode="decimal" />
                    <TextField name="discount_percent" label="Discount %" inputMode="decimal" />
                    <TextField name="min_order_qty" label="Minimum quantity" inputMode="decimal" defaultValue="1" />
                    <TextField name="qty_step" label="Order in steps of" inputMode="decimal" defaultValue="1" />
                    <div className="col-span-2 flex flex-wrap gap-4">
                      <Checkbox name="is_default" label="Default unit" />
                      <input type="hidden" name="is_active" value="true" />
                    </div>
                    <div className="col-span-2"><SubmitButton variant="secondary">Save selling unit</SubmitButton></div>
                    <p className="col-span-2 text-xs text-ink-muted">Price changes apply to new orders only. Existing orders keep the price they were placed at. Price changes are recorded in the audit log.</p>
                  </ActionForm>
                </details>
                <details className="rounded-md border border-line p-3">
                  <summary className="cursor-pointer text-sm font-medium">Edit variant</summary>
                  <ActionForm action={updateVariantAction} className="mt-3 space-y-3">
                    <input type="hidden" name="variant_id" value={v.id} />
                    <input type="hidden" name="product_id" value={product.id} />
                    <TextField name="name" label="Variant name" defaultValue={v.name} />
                    <TextField name="low_stock_threshold" label={`Low stock alert at (${v.base_unit})`} defaultValue={v.low_stock_threshold} inputMode="decimal" />
                    <Checkbox name="track_batches" label="Track batches and expiry" defaultChecked={v.track_batches} />
                    <Checkbox name="is_active" label="Active (visible to retailers)" defaultChecked={v.is_active} />
                    <SubmitButton variant="secondary">Save variant</SubmitButton>
                  </ActionForm>
                </details>
              </div>
            ) : null}
          </Card>
        ))}
      </div>

      {manager ? (
        <details className="mt-6">
          <summary className="btn btn-secondary list-none">Add another variant</summary>
          <ActionForm action={addVariantAction} className="mt-4 max-w-3xl space-y-4">
            <input type="hidden" name="product_id" value={product.id} />
            <VariantFields units={units} legend="New variant" />
            <SubmitButton>Add variant</SubmitButton>
          </ActionForm>
        </details>
      ) : null}

      <h2 className="mt-10 mb-3 text-lg font-semibold">Product details</h2>
      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        {manager ? (
          <ProductForm action={updateProductAction} categories={categories} brands={brands} taxClasses={taxClasses} units={units} product={product} withVariant={false} submitLabel="Save product details" />
        ) : (
          <Notice tone="info">Only owners and managers can edit product details and prices.</Notice>
        )}
        <div>
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} alt={product.name} className="w-full rounded-lg border border-line" />
          ) : (
            <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-line-strong text-sm text-ink-muted">No image</div>
          )}
        </div>
      </div>
    </>
  );
}

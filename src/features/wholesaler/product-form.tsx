"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui";
import { ActionForm, SelectField, SubmitButton, TextareaField, TextField, FieldErrorText } from "@/components/ui/client";
import type { ActionState } from "@/lib/action-state";

type Attr = { key: string; label: string; type: "text" | "number"; required?: boolean };
type Cat = { id: string; name: string; attribute_schema: Attr[] };
type Unit = { code: string; name: string; dimension: string };

export interface ProductFormProps {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  categories: Cat[];
  brands: { id: string; name: string }[];
  taxClasses: { id: string; name: string; rate: string }[];
  units: Unit[];
  product?: {
    id: string;
    name: string;
    description: string | null;
    category_id: string;
    brand_id: string | null;
    tax_class_id: string;
    hsn_code: string | null;
    price_includes_tax: boolean;
    attributes: Record<string, string | number>;
  };
  withVariant: boolean;
  submitLabel: string;
}

export function ProductForm({ action, categories, brands, taxClasses, units, product, withVariant, submitLabel }: ProductFormProps) {
  const [categoryId, setCategoryId] = useState(product?.category_id ?? categories[0]?.id ?? "");
  const cat = categories.find((c) => c.id === categoryId);
  return (
    <ActionForm action={action} className="space-y-6">
      {product ? <input type="hidden" name="product_id" value={product.id} /> : null}
      <fieldset className="card space-y-4 p-5">
        <legend className="px-1 font-semibold">Product</legend>
        <TextField name="name" label="Product name" required defaultValue={product?.name} placeholder="e.g. Sahyadri Masala Chips" />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField name="category_id" label="Category" required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
          <SelectField name="brand_id" label="Brand" defaultValue={product?.brand_id ?? ""}>
            <option value="">No brand / new brand below</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </SelectField>
        </div>
        {!product ? <TextField name="new_brand" label="New brand name" hint="Optional. Creates the brand if it does not exist." /> : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField name="tax_class_id" label="GST rate" required defaultValue={product?.tax_class_id ?? taxClasses.find((t) => Number(t.rate) === 5)?.id}>
            {taxClasses.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectField>
          <TextField name="hsn_code" label="HSN code" inputMode="numeric" defaultValue={product?.hsn_code ?? ""} hint="4 to 8 digits" />
          <div className="pt-7">
            <Checkbox name="price_includes_tax" label="Prices include GST" defaultChecked={product?.price_includes_tax} />
          </div>
        </div>
        <p className="text-xs text-ink-muted">Check the GST rate and HSN code for each product with your accountant. VyaporaFlow uses the values you enter.</p>
        {cat && cat.attribute_schema.length ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {cat.attribute_schema.map((a) => (
              <TextField key={`${cat.id}-${a.key}`} name={`attr.${a.key}`} label={a.label} type={a.type === "number" ? "number" : "text"} step="any" required={a.required} defaultValue={product?.attributes[a.key] !== undefined ? String(product.attributes[a.key]) : ""} />
            ))}
          </div>
        ) : null}
        <FieldErrorText name="attributes" />
        <TextareaField name="description" label="Description" rows={3} defaultValue={product?.description ?? ""} />
        <div>
          <label htmlFor="image" className="label">
            Product image
          </label>
          <input id="image" name="image" type="file" accept="image/png,image/jpeg,image/webp" className="block text-sm" />
          <p className="hint">PNG, JPEG or WebP, up to 2 MB.</p>
        </div>
      </fieldset>
      {withVariant ? <VariantFields units={units} /> : null}
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}

export function VariantFields({ units, legend = "First variant and selling units" }: { units: Unit[]; legend?: string }) {
  const [baseUnit, setBaseUnit] = useState("packet");
  // Selling-unit rows are controlled so the pack size can follow the stock unit:
  // selling in the stock unit itself always means a pack size of 1.
  const [codes, setCodes] = useState<string[]>(["packet", "", ""]);
  const [factors, setFactors] = useState<string[]>(["1", "", ""]);
  const unitName = (code: string) => units.find((u) => u.code === code)?.name.toLowerCase() ?? code;
  const changeBase = (next: string) => {
    setCodes((c) => c.map((code, i) => (i === 0 && code === baseUnit ? next : code)));
    setBaseUnit(next);
  };
  return (
    <fieldset className="card space-y-4 p-5">
      <legend className="px-1 font-semibold">{legend}</legend>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField name="variant.name" label="Variant" required placeholder="e.g. 52 g" />
        <TextField name="variant.sku" label="SKU" required placeholder="e.g. SSB-CHIPS-52" className="uppercase" />
        <SelectField name="variant.base_unit" label="Stock is counted in" required value={baseUnit} onChange={(e) => changeBase(e.target.value)} hint="The smallest unit you keep stock in">
          {units.map((u) => (
            <option key={u.code} value={u.code}>
              {u.name}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <TextField name="variant.opening_stock" label={`Opening stock (${baseUnit})`} inputMode="decimal" defaultValue="0" />
        <TextField name="variant.low_stock_threshold" label="Low stock alert at" inputMode="decimal" defaultValue="0" />
        <TextField name="variant.batch_no" label="Batch number" hint="Optional" />
        <TextField name="variant.expiry_date" label="Expiry date" type="date" hint="Optional" />
      </div>
      <Checkbox name="variant.track_batches" label="Track batches and expiry for this item" />
      <div>
        <p className="label">Selling units</p>
        <p className="hint mb-2">
          How retailers buy it. Pack size is how many {unitName(baseUnit)} are in one selling unit, for example a box of 24 {unitName(baseUnit)} has pack size 24. Selling by the {unitName(baseUnit)} itself is always pack size 1. Mark one as the default.
        </p>
        <FieldErrorText name="units" />
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-md border border-line p-3 sm:grid-cols-[1.2fr_1fr_1fr_1fr_0.8fr_0.8fr_auto] sm:items-end">
              <SelectField name={`units.${i}.unit_code`} label="Sold by" value={codes[i]} onChange={(e) => setCodes((c) => c.map((v, j) => (j === i ? e.target.value : v)))} required={i === 0}>
                {i > 0 ? <option value="">Not used</option> : null}
                {units.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.name}
                  </option>
                ))}
              </SelectField>
              {codes[i] && codes[i] === baseUnit ? (
                <TextField name={`units.${i}.factor_to_base`} label="Pack size" value="1" readOnly hint={`1 ${unitName(baseUnit)}`} />
              ) : (
                <TextField
                  name={`units.${i}.factor_to_base`}
                  label="Pack size"
                  inputMode="decimal"
                  value={factors[i]}
                  onChange={(e) => setFactors((f) => f.map((v, j) => (j === i ? e.target.value : v)))}
                  hint={codes[i] ? `${unitName(baseUnit)} per ${unitName(codes[i]!)}` : undefined}
                />
              )}
              <TextField name={`units.${i}.price`} label="Price (₹)" inputMode="decimal" required={i === 0} />
              <TextField name={`units.${i}.mrp`} label="MRP (₹)" inputMode="decimal" />
              <TextField name={`units.${i}.discount_percent`} label="Disc. %" inputMode="decimal" />
              <TextField name={`units.${i}.min_order_qty`} label="Min. qty" inputMode="decimal" defaultValue={i === 0 ? "1" : ""} />
              <label className="flex items-center gap-1 pb-2 text-sm">
                <input type="radio" name="default_unit" value={String(i)} defaultChecked={i === 0} className="accent-accent" /> Default
              </label>
              <input type="hidden" name={`units.${i}.qty_step`} value="" />
            </div>
          ))}
        </div>
      </div>
    </fieldset>
  );
}

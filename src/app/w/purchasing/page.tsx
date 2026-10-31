import Link from "next/link";
import { Badge, Card, EmptyState, Money, PageHeader } from "@/components/ui";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/ui/client";
import { createPurchaseOrderAction, createSupplierAction } from "@/features/wholesaler/actions";
import { formatDate, formatQuantity, humanize } from "@/lib/format";
import { listInventory } from "@/server/inventory";
import { listPurchaseOrders, listSuppliers, replenishmentSuggestions } from "@/server/purchasing";
import { requireWholesaler } from "@/server/viewer";

export default async function Purchasing() {
  const { viewer, company } = await requireWholesaler();
  const [suppliers, pos, suggestions, stock] = await Promise.all([
    listSuppliers(viewer.userId, company.companyId),
    listPurchaseOrders(viewer.userId, company.companyId),
    replenishmentSuggestions(viewer.userId, company.companyId),
    listInventory(viewer.userId, company.companyId, { pageSize: 500 }),
  ]);
  return (
    <>
      <PageHeader title="Purchasing" description="Record orders you place with your own suppliers and receive the goods into stock." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Restock suggestions" padded={false}>
          {suggestions.length === 0 ? <p className="p-4 text-sm text-ink-muted">Nothing is below its low-stock level.</p> : (
            <table className="data-table">
              <thead><tr><th scope="col">Item</th><th scope="col" className="num">Available</th><th scope="col" className="num">Suggested order</th></tr></thead>
              <tbody>
                {suggestions.map((s) => <tr key={s.variant_id}><td>{s.product_name} {s.variant_name}</td><td className="num">{formatQuantity(s.available, s.base_unit)}</td><td className="num">{formatQuantity(s.suggested, s.base_unit)}</td></tr>)}
              </tbody>
            </table>
          )}
          <p className="p-3 text-xs text-ink-muted">Suggested quantity brings stock to twice the low-stock level. Adjust to your supplier&apos;s pack sizes.</p>
        </Card>
        <Card title="Purchase orders" padded={false}>
          {pos.length === 0 ? <div className="p-4"><EmptyState title="No purchase orders yet" /></div> : (
            <table className="data-table stack">
              <thead><tr><th scope="col">PO</th><th scope="col">Supplier</th><th scope="col">Status</th><th scope="col" className="num">Cost</th></tr></thead>
              <tbody>
                {pos.map((p) => (
                  <tr key={p.id}>
                    <td data-label="PO"><Link href={`/w/purchasing/${p.id}`} className="link font-medium">{p.po_number}</Link><span className="block text-xs text-ink-muted">{formatDate(p.created_at)}</span></td>
                    <td data-label="Supplier">{p.supplier_name}</td>
                    <td data-label="Status"><Badge tone={p.status === "received" ? "ok" : p.status === "cancelled" ? "neutral" : "progress"}>{humanize(p.status)}</Badge></td>
                    <td data-label="Cost" className="num"><Money value={p.total_cost} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="New purchase order">
          {suppliers.length === 0 ? <p className="text-sm text-ink-muted">Add a supplier first.</p> : (
            <ActionForm action={createPurchaseOrderAction} className="space-y-3">
              <SelectField name="supplier_id" label="Supplier" required>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </SelectField>
              <TextField name="expected_on" label="Expected on" type="date" />
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="grid grid-cols-[1fr_6rem_7rem] gap-2">
                  <SelectField name={`items.${i}.variant_id`} label={i === 0 ? "Item" : `Item ${i + 1}`} defaultValue="">
                    <option value="">{i === 0 ? "Choose an item" : "Not used"}</option>
                    {stock.rows.map((r) => <option key={r.variant_id} value={r.variant_id}>{r.product_name} {r.variant_name} ({r.base_unit})</option>)}
                  </SelectField>
                  <TextField name={`items.${i}.quantity`} label="Qty" inputMode="decimal" />
                  <TextField name={`items.${i}.unit_cost`} label="Unit cost ₹" inputMode="decimal" />
                </div>
              ))}
              <TextField name="notes" label="Notes" />
              <SubmitButton>Create purchase order</SubmitButton>
            </ActionForm>
          )}
        </Card>
        <Card title="Suppliers">
          <ul className="mb-4 space-y-1 text-sm">
            {suppliers.map((s) => <li key={s.id}><strong>{s.name}</strong> {s.phone ? `· ${s.phone}` : ""} {s.open_pos ? `· ${s.open_pos} open POs` : ""}</li>)}
          </ul>
          <details>
            <summary className="btn btn-secondary btn-sm list-none">Add supplier</summary>
            <ActionForm action={createSupplierAction} className="mt-3 space-y-3" resetOnSuccess>
              <TextField name="name" label="Supplier name" required />
              <div className="grid grid-cols-2 gap-3"><TextField name="contact_name" label="Contact" /><TextField name="phone" label="Phone" type="tel" /></div>
              <div className="grid grid-cols-2 gap-3"><TextField name="email" label="Email" type="email" /><TextField name="gstin" label="GSTIN" /></div>
              <TextField name="address" label="Address" />
              <SubmitButton variant="secondary">Save supplier</SubmitButton>
            </ActionForm>
          </details>
        </Card>
      </div>
    </>
  );
}

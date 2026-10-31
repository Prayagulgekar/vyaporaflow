import Link from "next/link";
import { Badge, Card, Money, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/client";
import { orNotFound } from "@/features/shared/util";
import { receiveGoodsAction } from "@/features/wholesaler/actions";
import { formatDate, formatQuantity, humanize } from "@/lib/format";
import { getPurchaseOrder } from "@/server/purchasing";
import { requireWholesaler } from "@/server/viewer";

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { viewer } = await requireWholesaler();
  const po = await orNotFound(getPurchaseOrder(viewer.userId, id));
  const open = po.status === "ordered" || po.status === "partially_received";
  return (
    <>
      <PageHeader eyebrow={<Link href="/w/purchasing" className="link">Purchasing</Link>} title={`Purchase order ${po.po_number}`} description={`${po.supplier_name} · created ${formatDate(po.created_at)}${po.expected_on ? ` · expected ${formatDate(po.expected_on)}` : ""}`} actions={<Badge tone={po.status === "received" ? "ok" : "progress"}>{humanize(po.status)}</Badge>} />
      <ActionForm action={receiveGoodsAction}>
        <input type="hidden" name="po_id" value={po.id} />
        <Card padded={false} title={`Items · total cost ₹${po.total_cost}`}>
          <table className="data-table stack">
            <thead><tr><th scope="col">Item</th><th scope="col" className="num">Ordered</th><th scope="col" className="num">Received</th><th scope="col" className="num">Unit cost</th>{open ? <><th scope="col">Receive now</th><th scope="col">Batch / expiry</th></> : null}</tr></thead>
            <tbody>
              {po.items.map((i) => {
                const remaining = Number(i.quantity) - Number(i.received_quantity);
                return (
                  <tr key={i.id}>
                    <td data-label="Item">{i.product_name} {i.variant_name}<span className="block text-xs text-ink-muted">{i.sku}</span></td>
                    <td data-label="Ordered" className="num">{formatQuantity(i.quantity, i.base_unit)}</td>
                    <td data-label="Received" className="num">{formatQuantity(i.received_quantity, i.base_unit)}</td>
                    <td data-label="Unit cost" className="num"><Money value={i.unit_cost} /></td>
                    {open ? (
                      <>
                        <td data-label="Receive now"><input name={`recv:${i.id}`} inputMode="decimal" defaultValue={remaining > 0 ? String(remaining) : ""} className="input w-28" aria-label={`Quantity received for ${i.product_name}`} /></td>
                        <td data-label="Batch / expiry" className="space-y-1">
                          <input name={`batch:${i.id}`} placeholder="Batch" className="input w-32" aria-label="Batch number" />
                          <input name={`expiry:${i.id}`} type="date" className="input w-36" aria-label="Expiry date" />
                        </td>
                      </>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        {open ? (
          <div className="mt-4 flex max-w-xl flex-wrap items-end gap-3">
            <div className="flex-1"><TextField name="note" label="Receipt note" placeholder="e.g. Supplier invoice 2231" /></div>
            <SubmitButton>Receive into stock</SubmitButton>
          </div>
        ) : null}
      </ActionForm>
    </>
  );
}

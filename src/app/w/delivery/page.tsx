import Link from "next/link";
import { DeliveryStatusBadge, OrderStatusBadge } from "@/components/status";
import { Card, EmptyState, Money, PageHeader, Pagination } from "@/components/ui";
import { ActionForm, SelectField, SubmitButton } from "@/components/ui/client";
import type { OrderStatus } from "@/domain/order-status";
import { params, type SearchParams } from "@/features/shared/util";
import { assignDeliveryAction } from "@/features/wholesaler/actions";
import { formatDateTime } from "@/lib/format";
import { listAssignableMembers, listDeliveries, listUnassignedOrders } from "@/server/deliveries";
import { requireWholesaler } from "@/server/viewer";

export default async function Delivery({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const { viewer, company } = await requireWholesaler();
  const [page, unassigned, members] = await Promise.all([
    listDeliveries(viewer.userId, company.companyId, { status: sp.status ?? "active", worker: sp.worker, page: sp.page }),
    listUnassignedOrders(viewer.userId, company.companyId),
    listAssignableMembers(viewer.userId, company.companyId),
  ]);
  return (
    <>
      <PageHeader title="Delivery" description="Assign orders to your delivery staff and follow each delivery. Delivery staff update the status from their phone." />
      <Card title={`Waiting for a delivery person (${unassigned.length})`} padded={false}>
        {unassigned.length === 0 ? <p className="p-4 text-sm text-ink-muted">Every accepted order has someone assigned.</p> : (
          <table className="data-table stack">
            <thead><tr><th scope="col">Order</th><th scope="col">Retailer</th><th scope="col">Status</th><th scope="col" className="num">Total</th><th scope="col">Assign</th></tr></thead>
            <tbody>
              {unassigned.map((o) => (
                <tr key={o.id}>
                  <td data-label="Order"><Link href={`/w/orders/${o.id}`} className="link font-medium">{o.order_number}</Link><span className="block text-xs text-ink-muted">{formatDateTime(o.placed_at)}</span></td>
                  <td data-label="Retailer">{o.retailer_name}<span className="block text-xs text-ink-muted">{o.city}</span></td>
                  <td data-label="Status"><OrderStatusBadge status={o.status as OrderStatus} /></td>
                  <td data-label="Total" className="num"><Money value={o.grand_total} /></td>
                  <td data-label="Assign">
                    <ActionForm action={assignDeliveryAction} className="flex items-end gap-2">
                      <input type="hidden" name="order_id" value={o.id} />
                      <div className="min-w-40"><SelectField name="worker_id" label="Person" id={`w-${o.id}`}>
                        <option value="">Choose</option>
                        {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name} ({m.active_deliveries})</option>)}
                      </SelectField></div>
                      <SubmitButton size="sm" variant="secondary">Assign</SubmitButton>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <form className="mt-6 mb-4 flex flex-wrap gap-2">
        <label htmlFor="status" className="sr-only">Status</label>
        <select id="status" name="status" defaultValue={sp.status ?? "active"} className="input w-auto">
          <option value="active">In progress</option>
          <option value="assigned">Assigned</option>
          <option value="out_for_delivery">Out for delivery</option>
          <option value="delivered">Delivered</option>
          <option value="partially_delivered">Partially delivered</option>
          <option value="failed">Failed</option>
        </select>
        <label htmlFor="worker" className="sr-only">Delivery person</label>
        <select id="worker" name="worker" defaultValue={sp.worker ?? ""} className="input w-auto">
          <option value="">Everyone</option>
          {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
        </select>
        <button className="btn btn-secondary">Apply</button>
      </form>
      <Card padded={false}>
        {page.rows.length === 0 ? <div className="p-4"><EmptyState title="No deliveries match" /></div> : (
          <table className="data-table stack">
            <thead><tr><th scope="col">Order</th><th scope="col">Retailer</th><th scope="col">Delivery person</th><th scope="col">Status</th><th scope="col">Last update</th></tr></thead>
            <tbody>
              {page.rows.map((d) => (
                <tr key={d.id}>
                  <td data-label="Order"><Link href={`/w/orders/${d.order_id}`} className="link font-medium">{d.order_number}</Link></td>
                  <td data-label="Retailer">{d.retailer_name}<span className="block text-xs text-ink-muted">{d.city}</span></td>
                  <td data-label="Delivery person">{d.worker_name ?? "–"}</td>
                  <td data-label="Status"><DeliveryStatusBadge status={d.status} />{d.failure_reason ? <span className="block text-xs text-danger">{d.failure_reason}</span> : null}</td>
                  <td data-label="Last update">{formatDateTime(d.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Pagination page={page.page} pageCount={page.pageCount} total={page.total} basePath="/w/delivery" params={sp} />
    </>
  );
}

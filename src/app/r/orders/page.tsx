import Link from "next/link";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/status";
import { Card, EmptyState, Money, PageHeader, Pagination } from "@/components/ui";
import { params, type SearchParams } from "@/features/shared/util";
import { formatDateTime } from "@/lib/format";
import { listRetailerOrders } from "@/server/orders";
import { requireRetailer } from "@/server/viewer";

const TABS = [["", "All"], ["open", "In progress"], ["delivered", "Delivered"], ["cancelled", "Cancelled"]] as const;

export default async function RetailerOrders({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const { viewer, company } = await requireRetailer();
  const page = await listRetailerOrders(viewer.userId, company.companyId, sp);
  return (
    <>
      <PageHeader title="Orders" />
      <nav aria-label="Order status" className="mb-3 flex flex-wrap gap-1">
        {TABS.map(([k, label]) => (
          <Link key={k || "all"} href={`/r/orders${k ? `?status=${k}` : ""}`} aria-current={(sp.status ?? "") === k ? "page" : undefined} className={`rounded-full border px-3 py-1 text-sm ${(sp.status ?? "") === k ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-surface text-ink-muted"}`}>{label}</Link>
        ))}
      </nav>
      <form className="mb-4 flex gap-2" role="search">
        <input type="hidden" name="status" value={sp.status ?? ""} />
        <label htmlFor="q" className="sr-only">Search orders</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Order number or wholesaler" className="input" />
        <button className="btn btn-secondary">Search</button>
      </form>
      {page.rows.length === 0 ? <EmptyState title="No orders" /> : (
        <Card padded={false}>
          <table className="data-table stack">
            <thead><tr><th scope="col">Order</th><th scope="col">Wholesaler</th><th scope="col">Status</th><th scope="col">Payment</th><th scope="col" className="num">Total</th></tr></thead>
            <tbody>
              {page.rows.map((o) => (
                <tr key={o.id}>
                  <td data-label="Order"><Link href={`/r/orders/${o.id}`} className="link font-medium">{o.order_number}</Link><span className="block text-xs text-ink-muted">{formatDateTime(o.placed_at)}</span></td>
                  <td data-label="Wholesaler">{o.wholesaler_name}</td>
                  <td data-label="Status"><OrderStatusBadge status={o.status} partial={o.partially_delivered} /></td>
                  <td data-label="Payment"><PaymentStatusBadge status={o.payment_status} /></td>
                  <td data-label="Total" className="num"><Money value={o.grand_total} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Pagination page={page.page} pageCount={page.pageCount} total={page.total} basePath="/r/orders" params={sp} />
    </>
  );
}

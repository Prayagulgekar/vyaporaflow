import Link from "next/link";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/status";
import { ButtonLink, Card, EmptyState, Money, PageHeader, Pagination, SortHeader } from "@/components/ui";
import { ORDER_STATUSES, ORDER_STATUS_LABEL } from "@/domain/order-status";
import { params, type SearchParams } from "@/features/shared/util";
import { formatDateTime } from "@/lib/format";
import { listWholesalerOrders, orderStatusCounts } from "@/server/orders";
import { requireWholesaler } from "@/server/viewer";

export default async function Orders({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const { viewer, company } = await requireWholesaler();
  const [page, counts] = await Promise.all([listWholesalerOrders(viewer.userId, company.companyId, sp), orderStatusCounts(viewer.userId, company.companyId)]);
  const count = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
  const tabs = [["", "All"], ["open", "Open"], ...ORDER_STATUSES.map((s) => [s, ORDER_STATUS_LABEL[s]])] as [string, string][];
  return (
    <>
      <PageHeader title="Orders" description="Orders placed by your retailers. Open an order to accept, prepare, assign delivery or invoice it." actions={<ButtonLink href={`/w/export/orders?period=30d`} variant="secondary" prefetch={false}>Export CSV (30 days)</ButtonLink>} />
      <nav aria-label="Filter by status" className="mb-4 flex gap-1 overflow-x-auto pb-1">
        {tabs.map(([k, label]) => {
          const active = (sp.status ?? "") === k;
          const n = k === "" ? null : k === "open" ? null : count(k);
          return (
            <Link key={k || "all"} href={`/w/orders${k ? `?status=${k}` : ""}`} aria-current={active ? "page" : undefined} className={`shrink-0 rounded-full border px-3 py-1 text-sm ${active ? "border-accent bg-accent-soft font-medium text-accent-strong" : "border-line bg-surface text-ink-muted hover:border-line-strong"}`}>
              {label}
              {n ? <span className="ml-1 tabular-nums">({n})</span> : null}
            </Link>
          );
        })}
      </nav>
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]" role="search">
        <input type="hidden" name="status" value={sp.status ?? ""} />
        <label className="sr-only" htmlFor="q">Search orders</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Search order number or retailer" className="input" />
        <label className="sr-only" htmlFor="payment">Payment</label>
        <select id="payment" name="payment" defaultValue={sp.payment ?? ""} className="input">
          <option value="">Any payment status</option>
          <option value="not_invoiced">Not invoiced</option>
          <option value="unpaid">Unpaid</option>
          <option value="partially_paid">Partly paid</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
        </select>
        <label className="sr-only" htmlFor="from">From date</label>
        <input id="from" type="date" name="from" defaultValue={sp.from} className="input" aria-label="From date" />
        <label className="sr-only" htmlFor="to">To date</label>
        <input id="to" type="date" name="to" defaultValue={sp.to} className="input" aria-label="To date" />
        <button className="btn btn-secondary">Apply</button>
      </form>
      <Card padded={false}>
        {page.rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No orders match">Try another status or clear the search.</EmptyState>
          </div>
        ) : (
          <table className="data-table stack">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <SortHeader label="Retailer" column="retailer" sort={sp.sort} dir={sp.dir} basePath="/w/orders" params={sp} />
                <SortHeader label="Placed" column="placed_at" sort={sp.sort ?? "placed_at"} dir={sp.dir ?? "desc"} basePath="/w/orders" params={sp} />
                <SortHeader label="Status" column="status" sort={sp.sort} dir={sp.dir} basePath="/w/orders" params={sp} />
                <th scope="col">Payment</th>
                <SortHeader label="Total" column="grand_total" sort={sp.sort} dir={sp.dir} basePath="/w/orders" params={sp} className="num" />
              </tr>
            </thead>
            <tbody>
              {page.rows.map((o) => (
                <tr key={o.id}>
                  <td data-label="Order">
                    <Link href={`/w/orders/${o.id}`} className="link font-medium">{o.order_number}</Link>
                    <span className="block text-xs text-ink-muted">{o.items_count} items</span>
                  </td>
                  <td data-label="Retailer">{o.retailer_name}</td>
                  <td data-label="Placed">{formatDateTime(o.placed_at)}</td>
                  <td data-label="Status"><OrderStatusBadge status={o.status} partial={o.partially_delivered} /></td>
                  <td data-label="Payment"><PaymentStatusBadge status={o.payment_status} /></td>
                  <td data-label="Total" className="num"><Money value={o.grand_total} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Pagination page={page.page} pageCount={page.pageCount} total={page.total} basePath="/w/orders" params={sp} />
    </>
  );
}

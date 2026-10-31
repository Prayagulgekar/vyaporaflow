import Link from "next/link";
import { DailyBarChart } from "@/components/bar-chart";
import { OrderStatusBadge } from "@/components/status";
import { ButtonLink, Card, EmptyState, Money, Notice, PageHeader, Stat } from "@/components/ui";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/domain/order-status";
import { formatDateTime } from "@/lib/format";
import { listWholesalerOrders } from "@/server/orders";
import { dashboardMetrics, resolvePeriod, salesByDay } from "@/server/reports";
import { requireWholesaler } from "@/server/viewer";

const PERIODS = [
  ["today", "Today"],
  ["7d", "7 days"],
  ["30d", "30 days"],
  ["month", "This month"],
] as const;

export default async function Overview({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string; welcome?: string }> }) {
  const sp = await searchParams;
  const { viewer, company } = await requireWholesaler();
  const period = resolvePeriod(sp.period, sp.from, sp.to);
  const [m, daily, recent] = await Promise.all([
    dashboardMetrics(viewer.userId, company.companyId, period),
    salesByDay(viewer.userId, company.companyId, period),
    listWholesalerOrders(viewer.userId, company.companyId, { status: "open", sort: "placed_at", dir: "desc", pageSize: 8 }),
  ]);
  const pipelineOrder: OrderStatus[] = ["placed", "accepted", "preparing", "ready_for_delivery", "out_for_delivery"];
  return (
    <>
      <PageHeader
        title={`Good to see you, ${viewer.fullName.split(" ")[0] || "there"}`}
        description={`${company.companyName} · figures for ${period.label.toLowerCase()}, calculated from your records`}
        actions={
          <nav aria-label="Period" className="flex flex-wrap gap-1 rounded-md border border-line bg-surface p-1">
            {PERIODS.map(([k, label]) => (
              <Link key={k} href={`/w?period=${k}`} aria-current={period.key === k ? "page" : undefined} className={`rounded px-2.5 py-1 text-sm ${period.key === k ? "bg-accent text-white" : "text-ink-muted hover:bg-sunken"}`}>
                {label}
              </Link>
            ))}
          </nav>
        }
      />
      {sp.welcome ? (
        <div className="mb-6">
          <Notice tone="ok" title="Your business is set up">
            Next: <Link href="/w/products/new" className="link">add your first product</Link>, then set your <Link href="/w/profile" className="link">delivery coverage and hours</Link>.
          </Notice>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Orders today" value={m.orders_today} href="/w/orders?status=placed" hint={`${m.pipeline.placed ?? 0} waiting for you`} />
        <Stat label="Order value" value={<Money value={m.order_value} />} hint={`${m.orders_in_period} orders · ${period.label}`} />
        <Stat label="Payments received" value={<Money value={m.payments_received} />} href="/w/payments" hint={period.label} />
        <Stat label="Outstanding" value={<Money value={m.outstanding} />} href="/w/balances" hint={Number(m.overdue) > 0 ? <span className="text-danger">Overdue <Money value={m.overdue} /></span> : "Nothing overdue"} tone={Number(m.overdue) > 0 ? "warn" : undefined} />
        <Stat label="Net sales (invoiced)" value={<Money value={m.net_sales} />} href="/w/reports" hint={`Invoices less credit notes · ${period.label}`} />
        <Stat label="Delivered" value={m.delivered_in_period} hint={period.label} />
        <Stat label="Low stock items" value={m.low_stock} href="/w/inventory?filter=low" tone={m.low_stock > 0 ? "warn" : undefined} />
        <Stat label="Retailer requests" value={m.pending_retailers} href="/w/retailers?status=pending" tone={m.pending_retailers > 0 ? "warn" : undefined} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Invoiced sales per day" actions={<span className="text-xs text-ink-muted">{period.label}</span>}>
          {daily.length > 1 ? <DailyBarChart title="Invoiced sales per day" data={daily.map((d) => ({ day: d.day, value: d.invoiced }))} /> : <p className="text-sm text-ink-muted">Choose a longer period to see a daily chart. Invoiced today: <Money value={daily[0]?.invoiced ?? "0"} /></p>}
        </Card>
        <Card title="Orders in progress">
          <ul className="space-y-2 text-sm">
            {pipelineOrder.map((s) => (
              <li key={s} className="flex items-center justify-between">
                <Link href={`/w/orders?status=${s}`} className="hover:underline">
                  {ORDER_STATUS_LABEL[s]}
                </Link>
                <span className="font-semibold tabular-nums">{m.pipeline[s] ?? 0}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Open orders" className="mt-6" padded={false} actions={<ButtonLink href="/w/orders" variant="ghost" size="sm">All orders</ButtonLink>}>
        {recent.rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No open orders">New orders from retailers will appear here.</EmptyState>
          </div>
        ) : (
          <table className="data-table stack">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Retailer</th>
                <th scope="col">Placed</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {recent.rows.map((o) => (
                <tr key={o.id}>
                  <td data-label="Order">
                    <Link href={`/w/orders/${o.id}`} className="link font-medium">
                      {o.order_number}
                    </Link>
                  </td>
                  <td data-label="Retailer">{o.retailer_name}</td>
                  <td data-label="Placed">{formatDateTime(o.placed_at)}</td>
                  <td data-label="Status">
                    <OrderStatusBadge status={o.status} />
                  </td>
                  <td data-label="Total" className="num">
                    <Money value={o.grand_total} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

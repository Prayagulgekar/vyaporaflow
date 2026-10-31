import Link from "next/link";
import { OrderStatusBadge } from "@/components/status";
import { ButtonLink, Card, EmptyState, Money, Notice, PageHeader } from "@/components/ui";
import { addMoney } from "@/domain/money";
import { formatDate } from "@/lib/format";
import { retailerBalances } from "@/server/billing";
import { getCarts } from "@/server/cart";
import { listRetailerOrders } from "@/server/orders";
import { listMyWholesalers } from "@/server/relationships";
import { requireRetailer } from "@/server/viewer";

export default async function RetailerHome({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { welcome } = await searchParams;
  const { viewer, company } = await requireRetailer();
  const [wholesalers, orders, carts, balances] = await Promise.all([
    listMyWholesalers(viewer.userId, company.companyId),
    listRetailerOrders(viewer.userId, company.companyId, { status: "open", pageSize: 5 }),
    getCarts(viewer.userId, company.companyId),
    retailerBalances(viewer.userId, company.companyId),
  ]);
  const approved = wholesalers.filter((w) => w.status === "approved");
  const owed = addMoney(...balances.map((b) => b.outstanding));
  return (
    <>
      <PageHeader title={company.companyName} description={`Hello ${viewer.fullName.split(" ")[0] || ""}. Order from your wholesalers and keep track of what you owe.`} />
      {welcome ? <div className="mb-4"><Notice tone="ok" title="Your shop is set up">Next, <Link href="/r/discover" className="link">find wholesalers near you</Link> and ask to connect.</Notice></div> : null}
      {carts.length ? (
        <Card title="Carts waiting to be ordered" className="mb-4">
          <ul className="space-y-2 text-sm">
            {carts.map((c) => (
              <li key={c.wholesaler_id} className="flex items-center justify-between gap-2">
                <span>{c.wholesaler_name} · {c.items.length} items</span>
                <span className="flex items-center gap-2">{c.quote ? <Money value={c.quote.grand_total} /> : null}<ButtonLink href={`/r/cart#w-${c.wholesaler_id}`} size="sm">Review</ButtonLink></span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="My wholesalers" actions={<Link href="/r/discover" className="link text-sm">Find more</Link>}>
          {approved.length === 0 ? (
            <EmptyState title="No wholesalers yet" action={<ButtonLink href="/r/discover">Find wholesalers</ButtonLink>}>Search near your shop and ask to connect.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {approved.map((w) => (
                <li key={w.wholesaler_id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <Link href={`/r/wholesalers/${w.wholesaler_id}`} className="link font-medium">{w.name}</Link>
                    <span className="block text-xs text-ink-muted">{w.city} · {w.product_count} products</span>
                  </span>
                  <ButtonLink href={`/r/wholesalers/${w.wholesaler_id}`} size="sm" variant="secondary">Order</ButtonLink>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Orders on the way" actions={<Link href="/r/orders" className="link text-sm">All orders</Link>}>
          {orders.rows.length === 0 ? <p className="text-sm text-ink-muted">No open orders.</p> : (
            <ul className="divide-y divide-line">
              {orders.rows.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span><Link href={`/r/orders/${o.id}`} className="link font-medium">{o.order_number}</Link><span className="block text-xs text-ink-muted">{o.wholesaler_name} · {formatDate(o.placed_at)}</span></span>
                  <OrderStatusBadge status={o.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="What you owe" className="mt-4" actions={<Link href="/r/payments" className="link text-sm">Details</Link>}>
        <p className="text-2xl font-semibold"><Money value={owed} /></p>
        <p className="text-sm text-ink-muted">Across {balances.filter((b) => Number(b.outstanding) !== 0).length} wholesalers</p>
      </Card>
    </>
  );
}

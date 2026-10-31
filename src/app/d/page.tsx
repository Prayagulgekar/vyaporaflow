import Link from "next/link";
import { DeliveryStatusBadge } from "@/components/status";
import { EmptyState, Money, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { listMyDeliveries } from "@/server/deliveries";
import { requireDeliveryWorker } from "@/server/viewer";

export default async function MyDeliveries({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const { scope } = await searchParams;
  const viewer = await requireDeliveryWorker();
  const s = scope === "completed" ? "completed" : "active";
  const rows = await listMyDeliveries(viewer.userId, s);
  return (
    <>
      <PageHeader title={s === "active" ? "My deliveries" : "Completed deliveries"} description="Only deliveries assigned to you are shown." />
      <nav className="mb-4 flex gap-1" aria-label="Delivery list">
        <Link href="/d" aria-current={s === "active" ? "page" : undefined} className={`rounded-full border px-3 py-1 text-sm ${s === "active" ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-surface"}`}>To do</Link>
        <Link href="/d?scope=completed" aria-current={s === "completed" ? "page" : undefined} className={`rounded-full border px-3 py-1 text-sm ${s === "completed" ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-surface"}`}>Completed</Link>
      </nav>
      {rows.length === 0 ? <EmptyState title={s === "active" ? "Nothing to deliver right now" : "No completed deliveries yet"}>New assignments appear here.</EmptyState> : (
        <ul className="space-y-3">
          {rows.map((d) => (
            <li key={d.id}>
              <Link href={`/d/${d.id}`} className="card block p-4 hover:border-line-strong">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{d.retailer_name}</p>
                    <p className="text-sm text-ink-muted">{d.delivery_address.line1}, {d.delivery_address.city} {d.delivery_address.pincode}</p>
                  </div>
                  <DeliveryStatusBadge status={d.status} />
                </div>
                <p className="mt-2 text-sm">
                  {d.order_number} · {d.items_count} items · <Money value={d.grand_total} /> · {d.wholesaler_name}
                </p>
                <p className="text-xs text-ink-faint">Updated {formatDateTime(d.updated_at)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

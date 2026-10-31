import Link from "next/link";
import { Badge, Card, EmptyState, Money, PageHeader, Stat } from "@/components/ui";
import { HANDOVER_STATUS_LABEL } from "@/domain/cash";
import { PAYMENT_METHOD_LABEL, formatDateTime, humanize } from "@/lib/format";
import { myCollections } from "@/server/collections";
import { requireDeliveryWorker } from "@/server/viewer";

export default async function MyCash() {
  const viewer = await requireDeliveryWorker();
  const { rows, totals, handovers } = await myCollections(viewer.userId);
  return (
    <>
      <PageHeader title="My cash" description="Money you collected from shops, and the cash the office has confirmed receiving from you." />
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <Stat label="Cash with you (to hand over)" value={<Money value={totals.pending} />} hint="Collected in cash and not yet confirmed by the office" tone={Number(totals.pending) > 0 ? "warn" : undefined} />
        <Stat label="Cash collected today" value={<Money value={totals.collected_today} />} />
      </div>
      <Card title="Payments you collected" padded={false}>
        {rows.length === 0 ? <div className="p-4"><EmptyState title="No payments recorded yet">Payments you record on a delivery appear here.</EmptyState></div> : (
          <ul className="divide-y divide-line">
            {rows.map((c) => (
              <li key={c.collection_id} className="p-4 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link href={`/d/${c.delivery_id}`} className="link font-semibold">{c.retailer_name}</Link>
                    <p className="text-ink-muted">{c.order_number} · {formatDateTime(c.collected_at)}</p>
                    <p className="text-xs text-ink-faint">{c.collection_number}{c.payment_number ? ` · receipt ${c.payment_number}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold"><Money value={c.amount} /> <span className="font-normal text-ink-muted">{PAYMENT_METHOD_LABEL[c.method] ?? c.method}</span></p>
                    {Number(c.pending_handover) > 0 ? <p className="text-xs text-warn">To hand over: <Money value={c.pending_handover} /></p> : null}
                    <Badge tone={c.handover_status === "pending" || c.handover_status === "partially_handed_over" ? "warn" : c.handover_status === "handed_over" ? "ok" : "neutral"}>{HANDOVER_STATUS_LABEL[c.handover_status] ?? humanize(c.handover_status)}</Badge>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Handovers confirmed by the office" className="mt-6" padded={false}>
        {handovers.length === 0 ? <p className="p-4 text-sm text-ink-muted">No handovers yet.</p> : (
          <ul className="divide-y divide-line">
            {handovers.map((h) => (
              <li key={h.handover_id} className="flex flex-wrap justify-between gap-2 p-4 text-sm">
                <span>
                  <strong>{h.handover_number}</strong> · {formatDateTime(h.received_at)}
                  <span className="block text-xs text-ink-muted">Received by {h.received_by_name ?? "office"}{Number(h.discrepancy) > 0 ? ` · ₹${h.discrepancy} short, still with you` : ""}</span>
                </span>
                <span className="text-right">
                  <Money value={h.received_amount} /> of <Money value={h.expected_amount} />
                  {h.status === "reversed" ? <span className="block"><Badge tone="danger">Reversed</Badge></span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

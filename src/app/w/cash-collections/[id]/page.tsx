import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import { Card, Money, Notice, PageHeader } from "@/components/ui";
import { HandoverStatusBadge } from "@/components/status";
import { addMoney } from "@/domain/money";
import { orNotFound } from "@/features/shared/util";
import { PAYMENT_METHOD_LABEL, formatDateTime } from "@/lib/format";
import { getCollection } from "@/server/collections";
import { requireWholesaler } from "@/server/viewer";

export default async function CollectionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { viewer, company } = await requireWholesaler();
  const c = await orNotFound(getCollection(viewer.userId, id));
  if (c.wholesaler_id !== company.companyId) notFound();
  const rows: [string, ReactNode][] = [
    ["Retailer", c.retailer_name],
    ["Order", <Link key="o" href={`/w/orders/${c.order_id}`} className="link">{c.order_number}</Link>],
    ["Collected by", c.worker_name ?? "–"],
    ["Collected at", formatDateTime(c.collected_at)],
    ["Method", PAYMENT_METHOD_LABEL[c.method] ?? c.method],
    ["Reference", c.reference ?? "–"],
    ["Receipt (payment)", c.payment_id ? <Link key="p" href={`/w/payments/${c.payment_id}`} className="link">{c.payment_number}</Link> : "None. Nothing was collected, so no payment was recorded."],
    ["Recorded by", c.recorded_by_name ?? "–"],
    ["Note", c.note ?? "–"],
  ];
  return (
    <>
      <PageHeader eyebrow={<Link href="/w/cash-collections" className="link">Cash Collections</Link>} title={`Collection ${c.collection_number}`} description={`${c.retailer_name} · ${c.order_number}`} actions={<HandoverStatusBadge status={c.handover_status} />} />
      {c.status === "reversed" ? <div className="mb-4"><Notice tone="warn" title={`Reversed ${formatDateTime(c.reversed_at)}`}>{c.reversal_reason}</Notice></div> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Collection">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {rows.map(([k, v]) => <Fragment key={k}><dt className="text-ink-muted">{k}</dt><dd>{v}</dd></Fragment>)}
          </dl>
        </Card>
        <div className="space-y-4">
          <Card title="Cash from the delivery person">
            <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
              <dt>Collected</dt><dd className="num"><Money value={c.amount} /></dd>
              <dt>Handed over to you</dt><dd className="num"><Money value={c.handed_over} /></dd>
              <dt className="font-semibold">Still with the worker</dt><dd className="num font-semibold"><Money value={c.pending_handover} /></dd>
            </dl>
            {c.handovers.length ? (
              <ul className="mt-3 divide-y divide-line border-t border-line text-sm">
                {c.handovers.map((h) => (
                  <li key={h.handover_id} className="flex justify-between py-1.5">
                    <Link href={`/w/cash-collections/handovers/${h.handover_id}`} className="link">{h.handover_number}</Link>
                    <span>{h.status === "reversed" ? "Reversed · " : ""}<Money value={h.amount} /> · {formatDateTime(h.received_at)} · {h.received_by_name ?? "–"}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
          <Card title="What the shop owes on this order">
            <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
              <dt>Due when collected</dt><dd className="num"><Money value={c.payable_before} /></dd>
              <dt>Order value{c.position?.invoice_number ? ` (invoice ${c.position.invoice_number})` : " (not invoiced yet)"}</dt><dd className="num"><Money value={c.position?.order_value} /></dd>
              <dt>Paid and credited</dt><dd className="num"><Money value={c.position ? addMoney(c.position.paid, c.position.credited) : null} /></dd>
              <dt className="font-semibold">Still due from the shop</dt><dd className="num font-semibold"><Money value={c.position?.balance_due} /></dd>
            </dl>
            <p className="mt-2 text-xs text-ink-muted">This is the shop&apos;s balance on this order. It does not change when the worker hands cash over.</p>
          </Card>
        </div>
      </div>
    </>
  );
}

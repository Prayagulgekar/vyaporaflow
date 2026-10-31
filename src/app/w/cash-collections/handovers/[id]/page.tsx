import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Money, Notice, PageHeader } from "@/components/ui";
import { ActionForm, ConfirmSubmit, TextField, UnlessOk } from "@/components/ui/client";
import { reverseHandoverAction } from "@/features/wholesaler/actions";
import { orNotFound } from "@/features/shared/util";
import { formatDateTime } from "@/lib/format";
import { getHandover } from "@/server/collections";
import { requireWholesaler } from "@/server/viewer";

export default async function HandoverDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const { saved } = await searchParams;
  const { viewer, company } = await requireWholesaler();
  const h = await orNotFound(getHandover(viewer.userId, id));
  if (h.wholesaler_id !== company.companyId) notFound();
  const manager = company.role === "owner" || company.role === "manager";
  const short = Number(h.discrepancy) > 0;
  return (
    <>
      <PageHeader eyebrow={<Link href="/w/cash-collections/handover" className="link">Handovers</Link>} title={`Handover ${h.handover_number}`} description={`Cash from ${h.worker_name ?? "delivery person"}`} actions={h.status === "reversed" ? <Badge tone="danger">Reversed</Badge> : <Badge tone="ok">Confirmed</Badge>} />
      {saved && h.status === "confirmed" ? (
        <div className="mb-4">
          <Notice tone={short ? "warn" : "ok"} title={`Handover ${h.handover_number} confirmed`}>
            Received <Money value={h.received_amount} /> of <Money value={h.expected_amount} />.{short ? <> <Money value={h.discrepancy} /> is short and stays pending with {h.worker_name ?? "the worker"}.</> : null}
          </Notice>
        </div>
      ) : null}
      {h.status === "reversed" ? <div className="mb-4"><Notice tone="warn" title={`Reversed ${formatDateTime(h.reversed_at)} by ${h.reversed_by_name ?? "–"}`}>{h.reversal_reason}</Notice></div> : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card title="Summary">
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
            <dt>Expected</dt><dd className="num"><Money value={h.expected_amount} /></dd>
            <dt>Received</dt><dd className="num font-semibold"><Money value={h.received_amount} /></dd>
            <dt>Short (still pending)</dt><dd className={`num ${short ? "text-warn" : ""}`}><Money value={h.discrepancy} /></dd>
            <dt>Received by</dt><dd>{h.received_by_name ?? "–"}</dd>
            <dt>When</dt><dd>{formatDateTime(h.received_at)}</dd>
          </dl>
          {h.note ? <p className="mt-3 rounded bg-sunken p-2 text-sm">{h.note}</p> : null}
        </Card>
        <Card title="Collections covered (oldest first)" padded={false}>
          <table className="data-table stack">
            <thead><tr><th scope="col">Collection</th><th scope="col">Retailer and order</th><th scope="col" className="num">Collected</th><th scope="col" className="num">In this handover</th><th scope="col" className="num">Still pending now</th></tr></thead>
            <tbody>
              {h.items.map((i) => (
                <tr key={i.collection_id}>
                  <td data-label="Collection"><Link href={`/w/cash-collections/${i.collection_id}`} className="link">{i.collection_number}</Link></td>
                  <td data-label="Retailer and order">{i.retailer_name}<span className="block text-xs text-ink-muted">{i.order_number}</span></td>
                  <td data-label="Collected" className="num"><Money value={i.collected} /></td>
                  <td data-label="In this handover" className="num"><Money value={i.amount} /></td>
                  <td data-label="Still pending now" className="num"><Money value={i.pending_now} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      {manager && h.status === "confirmed" ? (
        <Card title="Correct a mistake" className="mt-6">
          <ActionForm action={reverseHandoverAction} className="space-y-3">
            <input type="hidden" name="handover_id" value={h.handover_id} />
            <UnlessOk>
              <p className="text-sm text-ink-muted">Reversing keeps this record and marks it reversed. Its cash becomes pending with the worker again, so you can record the correct handover.</p>
              <TextField name="reason" label="Reason" required placeholder="e.g. Entered ₹2,500 instead of ₹250" />
              <ConfirmSubmit label="Reverse handover" title="Reverse this handover?" body="The cash will show as still with the delivery person. This is recorded in the audit log." confirmLabel="Reverse" />
            </UnlessOk>
          </ActionForm>
        </Card>
      ) : null}
    </>
  );
}

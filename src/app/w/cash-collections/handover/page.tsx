import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Badge, Card, EmptyState, Money, Notice, PageHeader } from "@/components/ui";
import { params, type SearchParams } from "@/features/shared/util";
import { HandoverForm } from "@/features/wholesaler/handover-form";
import { formatDateTime } from "@/lib/format";
import { listCashWorkers, listHandovers, pendingCash } from "@/server/collections";
import { requireWholesaler } from "@/server/viewer";

export default async function ReceiveCash({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const { viewer, company } = await requireWholesaler();
  const manager = company.role === "owner" || company.role === "manager";
  const workers = (await listCashWorkers(viewer.userId, company.companyId)).filter((w) => w.user_id !== viewer.userId || Number(w.pending) > 0);
  const worker = workers.find((w) => w.user_id === sp.worker);
  const [pending, history] = await Promise.all([
    worker ? pendingCash(viewer.userId, company.companyId, worker.user_id) : Promise.resolve([]),
    listHandovers(viewer.userId, company.companyId, { worker: worker?.user_id, limit: 50 }),
  ]);
  return (
    <>
      <PageHeader eyebrow={<Link href="/w/cash-collections" className="link">Cash Collections</Link>} title="Receive cash from a worker" description="Choose who is handing over cash, count it, and enter what you actually received. A shortfall stays pending with the worker." />
      {!manager ? <div className="mb-4"><Notice tone="info">Only owners and managers can confirm cash handovers. You can see the history below.</Notice></div> : null}
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <div className="min-w-60"><label htmlFor="worker" className="label">Delivery person</label>
          <select id="worker" name="worker" defaultValue={worker?.user_id ?? ""} className="input">
            <option value="">Choose</option>
            {workers.map((w) => <option key={w.user_id} value={w.user_id}>{w.full_name}{Number(w.pending) > 0 ? ` (₹${w.pending} with them)` : ""}</option>)}
          </select></div>
        <button className="btn btn-secondary">Show cash</button>
      </form>

      {worker && manager ? (
        <Card title={`Cash ${worker.full_name} still has to hand over`} className="mb-6">
          {worker.user_id === viewer.userId ? <Notice tone="warn">You cannot confirm a handover of cash you collected yourself. Ask another owner or manager.</Notice>
            : pending.length === 0 ? <EmptyState title="Nothing to hand over">All cash this person collected has been handed over.</EmptyState> : (
              <HandoverForm
                workerId={worker.user_id}
                workerName={worker.full_name}
                idempotencyKey={randomUUID()}
                items={pending.map((c) => ({ id: c.collection_id, number: c.collection_number, retailer: c.retailer_name, order: c.order_number, collectedAt: new Date(c.collected_at).toISOString(), amount: c.amount, pending: c.pending_handover }))}
              />
            )}
        </Card>
      ) : null}

      <Card title={worker ? `Handover history: ${worker.full_name}` : "Handover history"} padded={false}>
        {history.length === 0 ? <div className="p-4"><EmptyState title="No handovers yet" /></div> : (
          <table className="data-table stack">
            <thead><tr><th scope="col">Handover</th><th scope="col">Delivery person</th><th scope="col">Received by</th><th scope="col" className="num">Expected</th><th scope="col" className="num">Received</th><th scope="col" className="num">Short</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.handover_id}>
                  <td data-label="Handover"><Link href={`/w/cash-collections/handovers/${h.handover_id}`} className="link font-medium">{h.handover_number}</Link>{h.status === "reversed" ? <span className="ml-2"><Badge tone="danger">Reversed</Badge></span> : null}<span className="block text-xs text-ink-muted">{formatDateTime(h.received_at)}</span></td>
                  <td data-label="Delivery person">{h.worker_name ?? "–"}</td>
                  <td data-label="Received by">{h.received_by_name ?? "–"}</td>
                  <td data-label="Expected" className="num"><Money value={h.expected_amount} /></td>
                  <td data-label="Received" className="num"><Money value={h.received_amount} /></td>
                  <td data-label="Short" className="num">{Number(h.discrepancy) > 0 ? <span className="text-warn"><Money value={h.discrepancy} /></span> : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

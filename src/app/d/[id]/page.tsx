import { randomUUID } from "node:crypto";
import Link from "next/link";
import { DeliveryStatusBadge } from "@/components/status";
import { Badge, Card, Money, Notice, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton, TextField, UnlessOk } from "@/components/ui/client";
import { HANDOVER_STATUS_LABEL } from "@/domain/cash";
import { addMoney } from "@/domain/money";
import { completeDeliveryAction, recordCollectionAction, updateDeliveryAction } from "@/features/delivery/actions";
import { CollectionFields } from "@/features/delivery/collection-fields";
import { orNotFound } from "@/features/shared/util";
import { PAYMENT_METHOD_LABEL, formatDateTime, formatQuantity, humanize } from "@/lib/format";
import { getDeliveryCollection } from "@/server/collections";
import { getMyDelivery } from "@/server/deliveries";
import { requireDeliveryWorker } from "@/server/viewer";

/** Current time in India as a datetime-local value. */
function nowIstLocal() {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" }).slice(0, 16).replace(" ", "T");
}

export default async function DeliveryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ recorded?: string }> }) {
  const { id } = await params;
  const { recorded } = await searchParams;
  const viewer = await requireDeliveryWorker();
  const d = await orNotFound(getMyDelivery(viewer.userId, id));
  const { position, collections } = await getDeliveryCollection(viewer.userId, id);
  const just = collections.find((c) => c.collection_id === recorded);
  const due = position ? position.balance_due : d.grand_total;
  const money = { orderValue: position?.order_value ?? d.grand_total, paid: position ? addMoney(position.paid, position.credited) : "0", balanceDue: due, maxTime: nowIstLocal() };
  const delivered = d.status === "delivered" || d.status === "partially_delivered";
  const a = d.delivery_address;
  const mapQuery = encodeURIComponent(`${a.line1}, ${a.city} ${a.pincode}`);
  return (
    <>
      <PageHeader eyebrow={<Link href="/d" className="link">My deliveries</Link>} title={d.retailer_name} description={`${d.order_number} from ${d.wholesaler_name}`} actions={<DeliveryStatusBadge status={d.status} />} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Where">
          <address className="not-italic">{a.line1}{a.line2 ? `, ${a.line2}` : ""}<br />{a.city} {a.pincode}</address>
          <div className="mt-3 flex flex-wrap gap-2">
            {d.retailer_phone ? <a href={`tel:${d.retailer_phone}`} className="btn btn-secondary btn-sm">Call {d.retailer_contact ?? "shop"}</a> : null}
            <a href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">Open in maps</a>
          </div>
          {d.order_notes ? <p className="mt-3 rounded bg-sunken p-2 text-sm">Retailer note: {d.order_notes}</p> : null}
          {d.notes ? <p className="mt-2 rounded bg-sunken p-2 text-sm">Office note: {d.notes}</p> : null}
        </Card>
        <Card title={`Items (${d.items.length}) · order value ₹${d.grand_total}`}>
          <ul className="divide-y divide-line text-sm">
            {d.items.map((i) => (
              <li key={i.id} className="flex justify-between py-1.5"><span>{i.product_name} {i.variant_name}</span><span className="font-medium tabular-nums">{formatQuantity(i.quantity, i.unit_code)}</span></li>
            ))}
          </ul>
          {d.requires_empty_return ? <div className="mt-3"><Notice tone="warn">Collect empty cylinders from the retailer and record how many.</Notice></div> : null}
        </Card>
      </div>

      {d.status === "assigned" ? (
        <ActionForm action={updateDeliveryAction} className="mt-6">
          <input type="hidden" name="delivery_id" value={d.id} />
          <input type="hidden" name="to" value="out_for_delivery" />
          <UnlessOk><SubmitButton className="w-full py-3 text-base sm:w-auto" pendingLabel="Starting…">Start delivery</SubmitButton></UnlessOk>
        </ActionForm>
      ) : null}

      {d.status === "out_for_delivery" ? (
        <div className="mt-6 space-y-4">
          <Card title="Delivered: record the payment">
            <ActionForm action={completeDeliveryAction} className="space-y-3">
              <input type="hidden" name="delivery_id" value={d.id} />
              <input type="hidden" name="to" value="delivered" />
              <input type="hidden" name="idempotency_key" value={randomUUID()} />
              <UnlessOk>
                <CollectionFields {...money} idPrefix="full" />
                <TextField name="recipient_name" label="Received by" placeholder="Name of the person at the shop" />
                {d.requires_empty_return ? <TextField name="empties_collected" label="Empty cylinders collected" type="number" min={0} required /> : null}
                <TextField name="note" label="Delivery note" placeholder="e.g. Left with the shop assistant" />
                <SubmitButton className="w-full py-3 text-base sm:w-auto" pendingLabel="Saving…">Delivered in full and save payment</SubmitButton>
              </UnlessOk>
            </ActionForm>
          </Card>
          <details className="card p-4">
            <summary className="cursor-pointer font-semibold">Only part of the order was delivered</summary>
            <ActionForm action={completeDeliveryAction} className="mt-3 space-y-3">
              <input type="hidden" name="delivery_id" value={d.id} />
              <input type="hidden" name="to" value="partially_delivered" />
              <input type="hidden" name="idempotency_key" value={randomUUID()} />
              <UnlessOk>
                <p className="text-sm text-ink-muted">Enter the quantity actually handed over for each item. The rest goes back to stock.</p>
                {d.items.map((i) => (
                  <div key={i.id} className="grid grid-cols-[1fr_7rem] items-center gap-2 text-sm">
                    <label htmlFor={`del-${i.id}`}>{i.product_name} {i.variant_name} (ordered {formatQuantity(i.quantity, i.unit_code)})</label>
                    <input id={`del-${i.id}`} name={`del:${i.id}`} inputMode="decimal" defaultValue={i.quantity} className="input text-right" />
                  </div>
                ))}
                <TextField name="recipient_name" label="Received by" />
                {d.requires_empty_return ? <TextField name="empties_collected" label="Empty cylinders collected" type="number" min={0} /> : null}
                <TextField name="note" label="Why was part not delivered?" required />
                <p className="text-sm text-ink-muted">The amount due drops to the value of what was handed over. The app checks the amount against that.</p>
                <CollectionFields {...money} idPrefix="part" />
                <SubmitButton variant="secondary">Record partial delivery and payment</SubmitButton>
              </UnlessOk>
            </ActionForm>
          </details>
          <details className="card p-4">
            <summary className="cursor-pointer font-semibold">Could not deliver</summary>
            <ActionForm action={updateDeliveryAction} className="mt-3 space-y-3">
              <input type="hidden" name="delivery_id" value={d.id} />
              <input type="hidden" name="to" value="failed" />
              <UnlessOk>
                <TextField name="failure_reason" label="Reason" required placeholder="e.g. Shop closed" />
                <TextField name="note" label="Note" />
                <SubmitButton variant="danger">Record failed attempt</SubmitButton>
              </UnlessOk>
            </ActionForm>
          </details>
        </div>
      ) : null}

      {d.status !== "assigned" && d.status !== "out_for_delivery" ? (
        <div className="mt-6"><Notice tone={d.status === "failed" ? "warn" : "ok"} title={humanize(d.status)}>{d.failure_reason ?? (d.recipient_name ? `Received by ${d.recipient_name}` : "This delivery is complete.")}{d.empties_collected !== null ? ` · ${d.empties_collected} empties collected` : ""}</Notice></div>
      ) : null}

      {just ? (
        <div className="mt-4">
          <Notice tone="ok" title={Number(just.amount) > 0 ? `Saved: ₹${just.amount} ${just.method === "upi" ? "by UPI" : "in cash"}` : "Saved: nothing collected"}>
            {just.payment_number ? <>Receipt <strong>{just.payment_number}</strong> · </> : null}Reference <strong>{just.collection_number}</strong>
            {just.balance_due_now !== null ? <> · Shop still owes <Money value={just.balance_due_now} /></> : null}
            {just.method === "cash" && Number(just.amount) > 0 ? <span className="block">Keep this cash safe and hand it to the office. It shows under My cash until they confirm it.</span> : null}
          </Notice>
        </div>
      ) : null}

      {delivered ? (
        <Card title="Payments collected on this delivery" className="mt-6">
          {collections.length === 0 ? (
            <p className="text-sm text-ink-muted">No payment recorded yet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {collections.map((c) => (
                <li key={c.collection_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <strong><Money value={c.amount} /></strong> {PAYMENT_METHOD_LABEL[c.method] ?? c.method} · {formatDateTime(c.collected_at)}
                    <span className="block text-xs text-ink-muted">{c.collection_number}{c.payment_number ? ` · receipt ${c.payment_number}` : ""}{c.reference ? ` · ref ${c.reference}` : ""}</span>
                  </span>
                  <Badge tone={c.handover_status === "pending" ? "warn" : c.handover_status === "reversed" ? "danger" : "neutral"}>{HANDOVER_STATUS_LABEL[c.handover_status] ?? humanize(c.handover_status)}</Badge>
                </li>
              ))}
            </ul>
          )}
          {Number(due) > 0 ? (
            <details className="mt-3" open={collections.length === 0}>
              <summary className="cursor-pointer font-semibold">{collections.length === 0 ? "Record the payment for this delivery" : "Record another payment"}</summary>
              <ActionForm action={recordCollectionAction} className="mt-3 space-y-3">
                <input type="hidden" name="delivery_id" value={d.id} />
                <input type="hidden" name="idempotency_key" value={randomUUID()} />
                <UnlessOk>
                  <CollectionFields {...money} idPrefix="later" />
                  <SubmitButton pendingLabel="Saving…">Save payment</SubmitButton>
                </UnlessOk>
              </ActionForm>
            </details>
          ) : <p className="mt-3 text-sm text-ink-muted">Nothing more is due on this order.</p>}
        </Card>
      ) : null}

      <Card title="History" className="mt-6">
        <ol className="space-y-2 text-sm">
          {d.events.map((e) => <li key={e.id}><strong>{humanize(e.to_status)}</strong> · {formatDateTime(e.created_at)}{e.actor_name ? ` · ${e.actor_name}` : ""}{e.note ? <span className="block text-ink-muted">{e.note}</span> : null}</li>)}
        </ol>
      </Card>
      <p className="mt-4 text-xs text-ink-muted">Order value <Money value={d.grand_total} />. Record only money you actually received. Cash you collect stays your responsibility until the office confirms the handover.</p>
    </>
  );
}

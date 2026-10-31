"use client";

import { useState } from "react";
import { Money } from "@/components/ui";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/client";
import { planHandover } from "@/domain/cash";
import { addMoney, compareMoney, isValidMoneyInput, subMoney } from "@/domain/money";
import { confirmHandoverAction } from "@/features/wholesaler/actions";
import { formatDateTime } from "@/lib/format";

export interface PendingItem {
  id: string;
  number: string;
  retailer: string;
  order: string;
  collectedAt: string;
  amount: string;
  pending: string;
}

/**
 * Count the cash, enter what you actually received, confirm. The preview shows
 * which collections it covers (oldest first) and any shortfall; the database
 * repeats the same calculation under a lock and refuses if anything changed.
 */
export function HandoverForm({ workerId, workerName, items, idempotencyKey }: { workerId: string; workerName: string; items: PendingItem[]; idempotencyKey: string }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.map((i) => i.id)));
  const [received, setReceived] = useState("");
  const chosen = items.filter((i) => selected.has(i.id));
  const expected = addMoney("0", ...chosen.map((i) => i.pending));
  const valid = isValidMoneyInput(received) && compareMoney(received, "0") > 0 && compareMoney(received, expected) <= 0;
  const plan = valid ? planHandover(chosen.map((i) => ({ id: i.id, collectedAt: i.collectedAt, pending: i.pending })), received) : null;
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  return (
    <ActionForm action={confirmHandoverAction} resetOnSuccess={false} className="space-y-4">
      <input type="hidden" name="worker_id" value={workerId} />
      <input type="hidden" name="expected" value={expected} />
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      {chosen.map((i) => <input key={i.id} type="hidden" name="collection_id" value={i.id} />)}
      <table className="data-table stack">
        <thead><tr><th scope="col"><span className="sr-only">Include</span></th><th scope="col">Collected</th><th scope="col">Retailer and order</th><th scope="col" className="num">Collected</th><th scope="col" className="num">To hand over</th></tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td data-label="Include"><input type="checkbox" aria-label={`Include ${i.number}`} checked={selected.has(i.id)} onChange={() => toggle(i.id)} className="size-4 accent-accent" /></td>
              <td data-label="Collected">{i.number}<span className="block text-xs text-ink-muted">{formatDateTime(i.collectedAt)}</span></td>
              <td data-label="Retailer and order">{i.retailer}<span className="block text-xs text-ink-muted">{i.order}</span></td>
              <td data-label="Collected" className="num"><Money value={i.amount} /></td>
              <td data-label="To hand over" className="num font-medium"><Money value={i.pending} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md bg-sunken p-3 text-sm">
          <p className="text-ink-muted">Expected cash from {workerName}</p>
          <p className="text-2xl font-semibold tabular-nums"><Money value={expected} /></p>
          <p className="text-xs text-ink-muted">{chosen.length} of {items.length} collections selected</p>
        </div>
        <div className="space-y-3">
          <TextField name="received" label="Cash you actually received (₹)" inputMode="decimal" required autoComplete="off" value={received} onChange={(e) => setReceived(e.currentTarget.value)} />
          <div aria-live="polite" className="text-sm">
            {received.trim() === "" ? null : !valid ? (
              <p className="text-danger">Enter an amount more than ₹0 and not more than <Money value={expected} />.</p>
            ) : plan && compareMoney(plan.discrepancy, "0") > 0 ? (
              <p className="text-warn">Short by <strong><Money value={plan.discrepancy} /></strong>. This stays pending with {workerName} and is recorded on the handover.</p>
            ) : (
              <p className="text-ok">Matches the expected cash.</p>
            )}
          </div>
        </div>
      </div>
      <TextField name="note" label="Note" placeholder="e.g. ₹50 short, will bring tomorrow" />
      <SubmitButton disabled={chosen.length === 0} pendingLabel="Confirming…">Confirm cash received</SubmitButton>
      <p className="text-xs text-ink-muted">This only records cash moving from the worker to you. It does not change any shop&apos;s balance (that changed when the payment was collected). Pending after this: <Money value={valid ? subMoney(expected, received) : expected} />.</p>
    </ActionForm>
  );
}

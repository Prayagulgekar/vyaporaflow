import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Card, Money, PageHeader } from "@/components/ui";
import { ActionForm, SelectField, SubmitButton, TextareaField, TextField } from "@/components/ui/client";
import { params, type SearchParams } from "@/features/shared/util";
import { recordPaymentAction } from "@/features/wholesaler/actions";
import { PAYMENT_METHOD_LABEL, formatDate, todayIST } from "@/lib/format";
import { formatINR } from "@/domain/money";
import { openInvoices } from "@/server/billing";
import { listRetailers } from "@/server/relationships";
import { requireWholesaler } from "@/server/viewer";

export default async function NewPayment({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const { viewer, company } = await requireWholesaler();
  const retailers = (await listRetailers(viewer.userId, company.companyId, { pageSize: 500, sort: "name" })).rows.filter((r) => r.status !== "rejected");
  const retailer = retailers.find((r) => r.retailer_id === sp.retailer);
  const invoices = retailer ? await openInvoices(viewer.userId, company.companyId, retailer.retailer_id) : [];
  return (
    <>
      <PageHeader eyebrow={<Link href="/w/payments" className="link">Payments</Link>} title="Record a payment" description="Record money after you have received it: cash in hand, a UPI credit, a bank transfer or a cheque." />
      <form className="mb-6 flex max-w-xl items-end gap-2">
        <div className="flex-1">
          <label htmlFor="retailer" className="label">Retailer</label>
          <select id="retailer" name="retailer" defaultValue={retailer?.retailer_id ?? ""} className="input">
            <option value="">Choose a retailer</option>
            {retailers.map((r) => <option key={r.retailer_id} value={r.retailer_id}>{r.name} (owes {formatINR(r.outstanding)})</option>)}
          </select>
        </div>
        <button className="btn btn-secondary">Choose</button>
      </form>
      {retailer ? (
        <ActionForm action={recordPaymentAction} className="grid max-w-4xl gap-6 lg:grid-cols-[1fr_1fr]">
          <input type="hidden" name="retailer_id" value={retailer.retailer_id} />
          <input type="hidden" name="idempotency_key" value={randomUUID()} />
          <Card title={`Payment from ${retailer.name}`}>
            <div className="space-y-4">
              <TextField name="amount" label="Amount received (₹)" inputMode="decimal" required autoFocus />
              <SelectField name="method" label="Method" defaultValue="upi">
                {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </SelectField>
              <TextField name="reference" label="Reference" hint="UPI transaction ID, cheque number or bank reference" />
              <TextField name="received_on" label="Date received" type="date" required defaultValue={todayIST()} max={todayIST()} />
              <TextareaField name="notes" label="Notes" rows={2} />
            </div>
          </Card>
          <Card title="Apply to invoices">
            <fieldset className="space-y-2 text-sm">
              <legend className="sr-only">Allocation</legend>
              <label className="flex gap-2"><input type="radio" name="allocation_mode" value="auto" defaultChecked className="accent-accent" /> Oldest invoices first (recommended)</label>
              <label className="flex gap-2"><input type="radio" name="allocation_mode" value="manual" className="accent-accent" /> I will choose amounts below</label>
              <label className="flex gap-2"><input type="radio" name="allocation_mode" value="none" className="accent-accent" /> Keep as advance, apply later</label>
            </fieldset>
            {invoices.length ? (
              <table className="data-table mt-3 text-sm">
                <thead><tr><th scope="col">Invoice</th><th scope="col">Due</th><th scope="col" className="num">Balance</th><th scope="col" className="num">Apply (₹)</th></tr></thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.invoice_id}>
                      <td>{i.invoice_number}</td>
                      <td>{formatDate(i.due_date)}</td>
                      <td className="num"><Money value={i.due} /></td>
                      <td className="num"><input name={`alloc:${i.invoice_id}`} inputMode="decimal" className="input w-28 text-right" aria-label={`Amount for ${i.invoice_number}`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-3 text-sm text-ink-muted">No unpaid invoices. The payment will be kept as an advance.</p>
            )}
            <p className="mt-3 text-xs text-ink-muted">Any amount not applied stays as an advance for this retailer and is shown on their statement.</p>
          </Card>
          <div className="lg:col-span-2"><SubmitButton pendingLabel="Recording…">Record payment</SubmitButton></div>
        </ActionForm>
      ) : null}
    </>
  );
}

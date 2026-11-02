import Link from "next/link";
import { Badge, Card, DefinitionList, Money, Notice, PageHeader } from "@/components/ui";
import { ActionForm, ConfirmSubmit, SelectField, SubmitButton, TextField } from "@/components/ui/client";
import { orNotFound } from "@/features/shared/util";
import { allocatePaymentAction, reversePaymentAction } from "@/features/wholesaler/actions";
import { PAYMENT_METHOD_LABEL, formatDateTime } from "@/lib/format";
import { DocumentShare, SharePanelToggle } from "@/components/document-share";
import { WhatsAppComposer } from "@/components/whatsapp";
import { netAllocations, paymentOptions, methodLabel } from "@/features/shared/whatsapp-options";
import { paymentReceiptMessage } from "@/lib/whatsapp-messages";
import { getPayment, openInvoices } from "@/server/billing";
import { loadParty } from "@/server/documents";
import { requireWholesaler } from "@/server/viewer";

export default async function PaymentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ recorded?: string }> }) {
  const { id } = await params;
  const { recorded } = await searchParams;
  const { viewer, company } = await requireWholesaler();
  const p = await orNotFound(getPayment(viewer.userId, id));
  const manager = company.role === "owner" || company.role === "manager";
  const invoices = p.status === "posted" && Number(p.unapplied) > 0 ? await openInvoices(viewer.userId, company.companyId, p.retailer_id) : [];
  const payer = await loadParty(viewer.userId, p.retailer_id);
  const greet = payer?.contact_name ?? p.counterparty;
  const waOptions = paymentOptions(p, greet, company.companyName);
  return (
    <>
      <PageHeader eyebrow={<Link href="/w/payments" className="link">Payments</Link>} title={`Payment ${p.payment_number}`} description={`From ${p.counterparty}`} actions={<>{p.status === "reversed" ? <Badge tone="danger">Reversed</Badge> : <Badge tone="ok">Recorded</Badge>}<a href={`/w/documents/receipt/${p.payment_id}?download=1`} className="btn btn-secondary btn-sm" data-testid="receipt-pdf">Receipt PDF</a>{p.status === "posted" ? <WhatsAppComposer phone={payer?.phone} recipientName={greet} options={waOptions} /> : null}</>} />
      {recorded ? <div className="mb-4"><Notice tone="ok">Payment recorded and posted to the ledger.</Notice></div> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Details">
          <DefinitionList
            items={[
              ["Amount", <Money key="a" value={p.amount} />],
              ["Method", PAYMENT_METHOD_LABEL[p.method] ?? p.method],
              ["Reference", p.reference ?? "–"],
              ["Received", formatDateTime(p.received_at)],
              ["Recorded by", p.recorded_by_name ?? "–"],
              ["Source", p.collection_id ? <Link key="s" href={`/w/cash-collections/${p.collection_id}`} className="link">Collected on delivery ({p.collection_number}){p.collected_by ? ` by ${p.collected_by}` : ""}</Link> : "Recorded by the office"],
              ["Applied to invoices", <Money key="b" value={p.allocated} />],
              ["Not yet applied (advance)", <Money key="c" value={p.unapplied} />],
              ["Verification", "Recorded manually (no payment gateway)"],
            ]}
          />
          {p.notes ? <p className="mt-3 rounded bg-sunken p-2 text-sm">{p.notes}</p> : null}
          {p.reversal ? <div className="mt-3"><Notice tone="warn" title={`Reversed ${formatDateTime(p.reversal.reversed_at)}`}>{p.reversal.reason}</Notice></div> : null}
        </Card>
        <Card title="Applied to">
          {p.allocations.length === 0 ? <p className="text-sm text-ink-muted">Not applied to any invoice yet.</p> : (
            <ul className="space-y-1 text-sm">
              {p.allocations.map((a, i) => (
                <li key={i} className={a.reversal ? "text-danger" : ""}>
                  <Link href={`/w/billing/${a.invoice_id}`} className="link">{a.invoice_number}</Link>: <Money value={a.amount} /> {a.reversal ? "(reversal)" : ""}
                </li>
              ))}
            </ul>
          )}
          {invoices.length ? (
            <ActionForm action={allocatePaymentAction} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
              <input type="hidden" name="payment_id" value={p.payment_id} />
              <SelectField name="invoice_id" label="Apply advance to">
                {invoices.map((i) => <option key={i.invoice_id} value={i.invoice_id}>{i.invoice_number} (due ₹{i.due})</option>)}
              </SelectField>
              <TextField name="amount" label="Amount" inputMode="decimal" defaultValue={p.unapplied} />
              <SubmitButton variant="secondary">Apply</SubmitButton>
            </ActionForm>
          ) : null}
        </Card>
      </div>
      {p.status === "posted" ? (
        <Card title="Share the payment receipt" className="mt-6">
          <p className="mb-3 text-sm text-ink-muted">A PDF receipt with the amount, method, reference and the invoices this payment was applied to.</p>
          <SharePanelToggle label="Prepare receipt to share">
            <DocumentShare
              testId="share-receipt"
              pdfUrl={`/w/documents/receipt/${p.payment_id}`}
              fallbackFilename="Payment-Receipt.pdf"
              title={`Payment receipt ${p.payment_number}`}
              phone={payer?.phone}
              recipientName={greet}
              message={paymentReceiptMessage({ recipientName: greet, senderBusiness: company.companyName, paymentNumber: p.payment_number, amount: p.amount, method: methodLabel(p.method), reference: p.reference, receivedAt: p.received_at, allocations: netAllocations(p.allocations), unapplied: p.unapplied, attached: true })}
            />
          </SharePanelToggle>
        </Card>
      ) : null}
      {manager && p.status === "posted" ? (
        <Card title="Reverse this payment" className="mt-6">
          <p className="mb-3 text-sm text-ink-muted">Use this when a cheque bounces or a payment was recorded by mistake. The payment stays on record, its invoice allocations are undone and the ledger is corrected.</p>
          <ActionForm action={reversePaymentAction}>
            <input type="hidden" name="payment_id" value={p.payment_id} />
            <ConfirmSubmit label="Reverse payment" title={`Reverse ${p.payment_number}?`} body="This cannot be undone. Record a new payment if the money is received later." confirmLabel="Reverse payment">
              <TextField name="reason" label="Reason" required placeholder="e.g. Cheque returned unpaid" />
            </ConfirmSubmit>
          </ActionForm>
        </Card>
      ) : null}
    </>
  );
}

import Link from "next/link";
import { PaymentStatusBadge } from "@/components/status";
import { ButtonLink, Card, Notice, PageHeader } from "@/components/ui";
import { ActionForm, ConfirmSubmit, SelectField, SubmitButton, TextField } from "@/components/ui/client";
import { InvoiceDocument, InvoiceSettlement } from "@/features/shared/invoice-view";
import { PrintButton } from "@/features/shared/print-button";
import { orNotFound } from "@/features/shared/util";
import { creditNoteAction, voidInvoiceAction } from "@/features/wholesaler/actions";
import { getInvoice } from "@/server/billing";
import { requireWholesaler } from "@/server/viewer";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { viewer, company } = await requireWholesaler();
  const inv = await orNotFound(getInvoice(viewer.userId, id));
  const manager = company.role === "owner" || company.role === "manager";
  const hasPayments = inv.allocations.some((a) => !a.reversal) && Number(inv.paid) > 0;
  return (
    <>
      <div className="print:hidden">
        <PageHeader
          eyebrow={<Link href="/w/billing" className="link">Invoices</Link>}
          title={`Invoice ${inv.invoice_number}`}
          description={<>For order <Link href={`/w/orders/${inv.order_id}`} className="link">{inv.order_number}</Link></>}
          actions={
            <>
              <PaymentStatusBadge status={inv.status === "void" ? "void" : inv.payment_status} />
              <PrintButton />
              {inv.status === "issued" && Number(inv.due) > 0 ? <ButtonLink href={`/w/payments/new?retailer=${inv.retailer_id}`} size="sm">Record payment</ButtonLink> : null}
            </>
          }
        />
        {inv.status === "void" ? <div className="mb-4"><Notice tone="warn" title="Void">{inv.void_reason}</Notice></div> : null}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <InvoiceDocument inv={inv} />
        <div className="space-y-6 print:hidden">
          <Card title="Payment status">
            <InvoiceSettlement inv={inv} paymentHref={(pid) => `/w/payments/${pid}`} />
          </Card>
          {manager && inv.status === "issued" ? (
            <Card title="Credit note">
              <ActionForm action={creditNoteAction} className="space-y-3" resetOnSuccess>
                <input type="hidden" name="invoice_id" value={inv.id} />
                <TextField name="amount" label="Amount (₹, incl. GST)" inputMode="decimal" required />
                <SelectField name="kind" label="Reason type" defaultValue="return">
                  <option value="return">Goods returned</option>
                  <option value="discount">Discount after sale</option>
                  <option value="correction">Price or quantity correction</option>
                </SelectField>
                <TextField name="reason" label="Details" required />
                <SubmitButton variant="secondary">Issue credit note</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
          {manager && inv.status === "issued" ? (
            <Card title="Void invoice">
              {hasPayments || inv.credit_notes.length ? (
                <p className="text-sm text-ink-muted">This invoice has payments or credit notes, so it cannot be voided. Reverse the payments or issue a credit note instead.</p>
              ) : (
                <ActionForm action={voidInvoiceAction}>
                  <input type="hidden" name="invoice_id" value={inv.id} />
                  <ConfirmSubmit label="Void invoice" title={`Void ${inv.invoice_number}?`} body="The invoice stays on record marked VOID and its ledger entry is reversed. You can then generate a new invoice for the order." confirmLabel="Void invoice">
                    <TextField name="reason" label="Reason" required />
                  </ConfirmSubmit>
                </ActionForm>
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

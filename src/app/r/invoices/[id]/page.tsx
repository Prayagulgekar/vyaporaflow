import Link from "next/link";
import { PaymentStatusBadge } from "@/components/status";
import { Card, PageHeader } from "@/components/ui";
import { InvoiceDocument, InvoiceSettlement } from "@/features/shared/invoice-view";
import { PrintButton } from "@/features/shared/print-button";
import { orNotFound } from "@/features/shared/util";
import { getInvoice } from "@/server/billing";
import { requireRetailer } from "@/server/viewer";

export default async function RetailerInvoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { viewer } = await requireRetailer();
  const inv = await orNotFound(getInvoice(viewer.userId, id));
  return (
    <>
      <div className="print:hidden">
        <PageHeader eyebrow={<Link href="/r/invoices" className="link">Invoices</Link>} title={`Invoice ${inv.invoice_number}`} actions={<><PaymentStatusBadge status={inv.status === "void" ? "void" : inv.payment_status} /><PrintButton /></>} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <InvoiceDocument inv={inv} />
        <Card title="Payment status" className="print:hidden">
          <InvoiceSettlement inv={inv} />
          <p className="mt-3 text-xs text-ink-muted">Pay the wholesaler directly. They record the payment here once received.</p>
        </Card>
      </div>
    </>
  );
}

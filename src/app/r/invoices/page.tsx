import Link from "next/link";
import { PaymentStatusBadge } from "@/components/status";
import { Card, EmptyState, Money, PageHeader, Pagination } from "@/components/ui";
import { params, type SearchParams } from "@/features/shared/util";
import { formatDate } from "@/lib/format";
import { listInvoices } from "@/server/billing";
import { requireRetailer } from "@/server/viewer";

export default async function RetailerInvoices({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const { viewer, company } = await requireRetailer();
  const page = await listInvoices(viewer.userId, "retailer", company.companyId, sp);
  return (
    <>
      <PageHeader title="Invoices" description="GST invoices from your wholesalers." />
      <form className="mb-4 flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">Search</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Invoice or order number, wholesaler" className="input" />
        <label htmlFor="status" className="sr-only">Status</label>
        <select id="status" name="status" defaultValue={sp.status ?? ""} className="input w-auto">
          <option value="">All</option>
          <option value="open">With balance due</option>
          <option value="overdue">Overdue</option>
          <option value="paid">Paid</option>
        </select>
        <button className="btn btn-secondary">Apply</button>
      </form>
      {page.rows.length === 0 ? <EmptyState title="No invoices yet" /> : (
        <Card padded={false}>
          <table className="data-table stack">
            <thead><tr><th scope="col">Invoice</th><th scope="col">Wholesaler</th><th scope="col">Due date</th><th scope="col">Status</th><th scope="col" className="num">Total</th><th scope="col" className="num">Due</th></tr></thead>
            <tbody>
              {page.rows.map((i) => (
                <tr key={i.invoice_id}>
                  <td data-label="Invoice"><Link href={`/r/invoices/${i.invoice_id}`} className="link font-medium">{i.invoice_number}</Link><span className="block text-xs text-ink-muted">{formatDate(i.invoice_date)}</span></td>
                  <td data-label="Wholesaler">{i.counterparty}</td>
                  <td data-label="Due date">{formatDate(i.due_date)}</td>
                  <td data-label="Status"><PaymentStatusBadge status={i.status === "void" ? "void" : i.payment_status} /></td>
                  <td data-label="Total" className="num"><Money value={i.grand_total} /></td>
                  <td data-label="Due" className="num"><Money value={i.due} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Pagination page={page.page} pageCount={page.pageCount} total={page.total} basePath="/r/invoices" params={sp} />
    </>
  );
}

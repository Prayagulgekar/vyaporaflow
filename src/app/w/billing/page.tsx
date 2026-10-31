import Link from "next/link";
import { PaymentStatusBadge } from "@/components/status";
import { ButtonLink, Card, EmptyState, Money, PageHeader, Pagination } from "@/components/ui";
import { params, type SearchParams } from "@/features/shared/util";
import { formatDate } from "@/lib/format";
import { listInvoices } from "@/server/billing";
import { requireWholesaler } from "@/server/viewer";

const TABS = [["", "All"], ["open", "Unpaid balance"], ["overdue", "Overdue"], ["partially_paid", "Partly paid"], ["paid", "Paid"], ["void", "Void"]] as const;

export default async function Invoices({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const { viewer, company } = await requireWholesaler();
  const page = await listInvoices(viewer.userId, "wholesaler", company.companyId, sp);
  return (
    <>
      <PageHeader title="Invoices" description="GST invoices are generated from delivered orders. Open an order to invoice it." actions={<ButtonLink href="/w/export/invoices?period=30d" variant="secondary" prefetch={false}>Export CSV (30 days)</ButtonLink>} />
      <nav aria-label="Invoice status" className="mb-3 flex flex-wrap gap-1">
        {TABS.map(([k, label]) => (
          <Link key={k || "all"} href={`/w/billing${k ? `?status=${k}` : ""}`} aria-current={(sp.status ?? "") === k ? "page" : undefined} className={`rounded-full border px-3 py-1 text-sm ${(sp.status ?? "") === k ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-surface text-ink-muted"}`}>{label}</Link>
        ))}
      </nav>
      <form className="mb-4 flex gap-2" role="search">
        <input type="hidden" name="status" value={sp.status ?? ""} />
        <label htmlFor="q" className="sr-only">Search invoices</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Invoice number, order number or retailer" className="input" />
        <button className="btn btn-secondary">Search</button>
      </form>
      <Card padded={false}>
        {page.rows.length === 0 ? (
          <div className="p-4"><EmptyState title="No invoices">Delivered orders can be invoiced from the order page.</EmptyState></div>
        ) : (
          <table className="data-table stack">
            <thead>
              <tr>
                <th scope="col">Invoice</th>
                <th scope="col">Retailer</th>
                <th scope="col">Date</th>
                <th scope="col">Due</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">Total</th>
                <th scope="col" className="num">Balance due</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.map((i) => (
                <tr key={i.invoice_id}>
                  <td data-label="Invoice"><Link href={`/w/billing/${i.invoice_id}`} className="link font-medium">{i.invoice_number}</Link><span className="block text-xs text-ink-muted">{i.order_number}</span></td>
                  <td data-label="Retailer">{i.counterparty}</td>
                  <td data-label="Date">{formatDate(i.invoice_date)}</td>
                  <td data-label="Due">{formatDate(i.due_date)}</td>
                  <td data-label="Status"><PaymentStatusBadge status={i.status === "void" ? "void" : i.payment_status} /></td>
                  <td data-label="Total" className="num"><Money value={i.grand_total} /></td>
                  <td data-label="Balance due" className="num"><Money value={i.due} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Pagination page={page.page} pageCount={page.pageCount} total={page.total} basePath="/w/billing" params={sp} />
    </>
  );
}

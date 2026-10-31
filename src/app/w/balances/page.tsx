import Link from "next/link";
import { Card, EmptyState, Money, PageHeader, Pagination, Stat } from "@/components/ui";
import { params, type SearchParams } from "@/features/shared/util";
import { formatDate } from "@/lib/format";
import { listBalances } from "@/server/billing";
import { receivablesAging } from "@/server/reports";
import { requireWholesaler } from "@/server/viewer";

export default async function Balances({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const { viewer, company } = await requireWholesaler();
  const [page, aging] = await Promise.all([listBalances(viewer.userId, company.companyId, sp), receivablesAging(viewer.userId, company.companyId)]);
  return (
    <>
      <PageHeader title="Outstanding balances" description="What each retailer owes you: invoices less credit notes and payments. Calculated from the ledger." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Total outstanding" value={<Money value={page.totals.outstanding} />} />
        <Stat label="Overdue" value={<Money value={page.totals.overdue} />} tone={Number(page.totals.overdue) > 0 ? "danger" : undefined} />
        <Stat label="Advances not yet applied" value={<Money value={page.totals.unapplied} />} />
      </div>
      <Card title="Ageing of unpaid invoices" className="mt-6" padded={false}>
        <table className="data-table">
          <thead><tr><th scope="col">Age</th><th scope="col" className="num">Invoices</th><th scope="col" className="num">Amount due</th></tr></thead>
          <tbody>
            {aging.length === 0 ? <tr><td colSpan={3} className="text-ink-muted">No unpaid invoices.</td></tr> : aging.map((a) => (
              <tr key={a.bucket}><td>{a.bucket.slice(2)}</td><td className="num">{a.invoices}</td><td className="num"><Money value={a.amount} /></td></tr>
            ))}
          </tbody>
        </table>
      </Card>
      <form className="mt-6 mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]" role="search">
        <label htmlFor="q" className="sr-only">Search</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Search retailer" className="input" />
        <label htmlFor="filter" className="sr-only">Show</label>
        <select id="filter" name="filter" defaultValue={sp.filter ?? "outstanding"} className="input">
          <option value="outstanding">With a balance</option>
          <option value="overdue">Overdue only</option>
          <option value="all">All retailers</option>
        </select>
        <label htmlFor="sort" className="sr-only">Sort</label>
        <select id="sort" name="sort" defaultValue={sp.sort ?? ""} className="input">
          <option value="">Highest balance</option>
          <option value="overdue">Most overdue</option>
          <option value="name">Name</option>
        </select>
        <button className="btn btn-secondary">Apply</button>
      </form>
      <Card padded={false}>
        {page.rows.length === 0 ? <div className="p-4"><EmptyState title="Nothing outstanding" /></div> : (
          <table className="data-table stack">
            <thead>
              <tr>
                <th scope="col">Retailer</th>
                <th scope="col" className="num">Invoiced</th>
                <th scope="col" className="num">Credits</th>
                <th scope="col" className="num">Received</th>
                <th scope="col" className="num">Overdue</th>
                <th scope="col">Oldest due</th>
                <th scope="col" className="num">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.map((r) => (
                <tr key={r.retailer_id}>
                  <td data-label="Retailer"><Link href={`/w/retailers/${r.retailer_id}`} className="link font-medium">{r.name}</Link>{r.credit_limit ? <span className="block text-xs text-ink-muted">Limit ₹{r.credit_limit}</span> : null}</td>
                  <td data-label="Invoiced" className="num"><Money value={r.invoiced} /></td>
                  <td data-label="Credits" className="num"><Money value={r.credited} /></td>
                  <td data-label="Received" className="num"><Money value={r.received} /></td>
                  <td data-label="Overdue" className={`num ${Number(r.overdue) > 0 ? "text-danger" : ""}`}><Money value={r.overdue} /></td>
                  <td data-label="Oldest due">{r.oldest_due_date ? formatDate(r.oldest_due_date) : "–"}</td>
                  <td data-label="Outstanding" className="num font-semibold"><Money value={r.outstanding} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Pagination page={page.page} pageCount={page.pageCount} total={page.total} basePath="/w/balances" params={sp} />
    </>
  );
}

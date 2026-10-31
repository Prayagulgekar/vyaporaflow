import Link from "next/link";
import { Badge, ButtonLink, Card, EmptyState, Money, PageHeader, Pagination } from "@/components/ui";
import { params, type SearchParams } from "@/features/shared/util";
import { PAYMENT_METHOD_LABEL, formatDateTime } from "@/lib/format";
import { listPayments } from "@/server/billing";
import { requireWholesaler } from "@/server/viewer";

export default async function Payments({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const { viewer, company } = await requireWholesaler();
  const page = await listPayments(viewer.userId, "wholesaler", company.companyId, sp);
  return (
    <>
      <PageHeader title="Payments" description="Money received from retailers, recorded by your team. VyaporaFlow does not collect payments online." actions={<ButtonLink href="/w/payments/new">Record payment</ButtonLink>} />
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]" role="search">
        <label htmlFor="q" className="sr-only">Search payments</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Payment number, retailer or reference" className="input" />
        <label htmlFor="method" className="sr-only">Method</label>
        <select id="method" name="method" defaultValue={sp.method ?? ""} className="input">
          <option value="">All methods</option>
          {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn btn-secondary">Apply</button>
      </form>
      <Card padded={false}>
        {page.rows.length === 0 ? (
          <div className="p-4"><EmptyState title="No payments recorded" action={<ButtonLink href="/w/payments/new">Record payment</ButtonLink>} /></div>
        ) : (
          <table className="data-table stack">
            <thead>
              <tr>
                <th scope="col">Payment</th>
                <th scope="col">Retailer</th>
                <th scope="col">Received</th>
                <th scope="col">Method</th>
                <th scope="col" className="num">Amount</th>
                <th scope="col" className="num">Not yet applied</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.map((p) => (
                <tr key={p.payment_id}>
                  <td data-label="Payment">
                    <Link href={`/w/payments/${p.payment_id}`} className="link font-medium">{p.payment_number}</Link>
                    {p.status === "reversed" ? <span className="ml-2"><Badge tone="danger">Reversed</Badge></span> : null}
                    {p.collection_id ? <Link href={`/w/cash-collections/${p.collection_id}`} className="block text-xs text-ink-muted hover:underline">Collected on delivery{p.collected_by ? ` by ${p.collected_by}` : ""}</Link> : null}
                  </td>
                  <td data-label="Retailer">{p.counterparty}</td>
                  <td data-label="Received">{formatDateTime(p.received_at)}</td>
                  <td data-label="Method">{PAYMENT_METHOD_LABEL[p.method] ?? p.method}{p.reference ? <span className="block text-xs text-ink-muted">Ref {p.reference}</span> : null}</td>
                  <td data-label="Amount" className="num"><Money value={p.amount} /></td>
                  <td data-label="Not yet applied" className="num">{Number(p.unapplied) ? <Money value={p.unapplied} /> : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Pagination page={page.page} pageCount={page.pageCount} total={page.total} basePath="/w/payments" params={sp} />
    </>
  );
}

import Link from "next/link";
import { Badge, Card, EmptyState, Money, PageHeader, Pagination } from "@/components/ui";
import { StatementTable } from "@/features/shared/statement";
import { params, type SearchParams } from "@/features/shared/util";
import { PAYMENT_METHOD_LABEL, formatDateTime } from "@/lib/format";
import { getStatement, listPayments, retailerBalances } from "@/server/billing";
import { requireRetailer } from "@/server/viewer";

export default async function RetailerPayments({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const { viewer, company } = await requireRetailer();
  const [balances, payments] = await Promise.all([
    retailerBalances(viewer.userId, company.companyId),
    listPayments(viewer.userId, "retailer", company.companyId, sp),
  ]);
  const selected = balances.find((b) => b.wholesaler_id === sp.wholesaler);
  const statement = selected ? await getStatement(viewer.userId, selected.wholesaler_id, company.companyId) : null;
  return (
    <>
      <PageHeader title="Payments and balances" description="Payments recorded by your wholesalers, and what you owe each of them." />
      <Card title="Balances" padded={false}>
        {balances.length === 0 ? <div className="p-4"><EmptyState title="No balances yet" /></div> : (
          <table className="data-table stack">
            <thead><tr><th scope="col">Wholesaler</th><th scope="col" className="num">Invoiced</th><th scope="col" className="num">Paid</th><th scope="col" className="num">Advance</th><th scope="col" className="num">You owe</th></tr></thead>
            <tbody>
              {balances.map((b) => (
                <tr key={b.wholesaler_id}>
                  <td data-label="Wholesaler"><Link href={`/r/payments?wholesaler=${b.wholesaler_id}`} className="link font-medium">{b.name}</Link></td>
                  <td data-label="Invoiced" className="num"><Money value={b.invoiced} /></td>
                  <td data-label="Paid" className="num"><Money value={b.received} /></td>
                  <td data-label="Advance" className="num">{Number(b.unapplied) ? <Money value={b.unapplied} /> : "–"}</td>
                  <td data-label="You owe" className="num font-semibold"><Money value={b.outstanding} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {statement && selected ? (
        <div className="mt-6">
          <h2 className="mb-2 text-lg font-semibold">Statement with {selected.name}</h2>
          <StatementTable lines={statement.lines} totals={statement.totals} />
        </div>
      ) : null}
      <Card title="Payments recorded" className="mt-6" padded={false}>
        {payments.rows.length === 0 ? <p className="p-4 text-sm text-ink-muted">No payments recorded yet.</p> : (
          <table className="data-table stack">
            <thead><tr><th scope="col">Payment</th><th scope="col">Wholesaler</th><th scope="col">Date</th><th scope="col">Method</th><th scope="col" className="num">Amount</th></tr></thead>
            <tbody>
              {payments.rows.map((p) => (
                <tr key={p.payment_id}>
                  <td data-label="Payment">{p.payment_number}{p.status === "reversed" ? <span className="ml-2"><Badge tone="danger">Reversed</Badge></span> : null}</td>
                  <td data-label="Wholesaler">{p.counterparty}</td>
                  <td data-label="Date">{formatDateTime(p.received_at)}</td>
                  <td data-label="Method">{PAYMENT_METHOD_LABEL[p.method] ?? p.method}{p.reference ? <span className="block text-xs text-ink-muted">Ref {p.reference}</span> : null}</td>
                  <td data-label="Amount" className="num"><Money value={p.amount} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Pagination page={payments.page} pageCount={payments.pageCount} total={payments.total} basePath="/r/payments" params={sp} />
    </>
  );
}

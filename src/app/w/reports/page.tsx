import Link from "next/link";
import { DailyBarChart } from "@/components/bar-chart";
import { ButtonLink, Card, Money, PageHeader } from "@/components/ui";
import { params, type SearchParams } from "@/features/shared/util";
import { PAYMENT_METHOD_LABEL, formatQuantity } from "@/lib/format";
import { collectionsByMethod, dashboardMetrics, resolvePeriod, salesByDay, taxSummary, topProducts } from "@/server/reports";
import { requireWholesaler } from "@/server/viewer";

export default async function Reports({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const { viewer, company } = await requireWholesaler();
  const period = resolvePeriod(sp.period, sp.from, sp.to);
  const [m, daily, top, methods, tax] = await Promise.all([
    dashboardMetrics(viewer.userId, company.companyId, period),
    salesByDay(viewer.userId, company.companyId, period),
    topProducts(viewer.userId, company.companyId, period),
    collectionsByMethod(viewer.userId, company.companyId, period),
    taxSummary(viewer.userId, company.companyId, period),
  ]);
  const q = `period=${period.key}${period.key === "custom" ? `&from=${period.from}&to=${period.to}` : ""}`;
  return (
    <>
      <PageHeader title="Reports" description={`${period.label} (${period.from} to ${period.to}). All figures come from your invoices, credit notes and payments.`} actions={<><ButtonLink href={`/w/export/orders?${q}`} variant="secondary" size="sm" prefetch={false}>Orders CSV</ButtonLink><ButtonLink href={`/w/export/invoices?${q}`} variant="secondary" size="sm" prefetch={false}>Invoices CSV</ButtonLink></>} />
      <form className="mb-6 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="period" className="label">Period</label>
          <select id="period" name="period" defaultValue={period.key} className="input">
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="month">This month</option>
            <option value="custom">Custom dates</option>
          </select>
        </div>
        <div><label htmlFor="from" className="label">From</label><input id="from" type="date" name="from" defaultValue={period.from} className="input" /></div>
        <div><label htmlFor="to" className="label">To</label><input id="to" type="date" name="to" defaultValue={period.to} className="input" /></div>
        <button className="btn btn-secondary">Show</button>
      </form>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Sales">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt>Invoiced</dt><dd><Money value={m.invoiced_sales} /></dd></div>
            <div className="flex justify-between"><dt>Credit notes</dt><dd>−<Money value={m.credit_notes} /></dd></div>
            <div className="flex justify-between border-t border-line pt-1 font-semibold"><dt>Net sales</dt><dd><Money value={m.net_sales} /></dd></div>
            <div className="flex justify-between pt-2 text-ink-muted"><dt>Orders placed (value)</dt><dd><Money value={m.order_value} /></dd></div>
          </dl>
        </Card>
        <Card title="Collections by method">
          {methods.length === 0 ? <p className="text-sm text-ink-muted">No payments in this period.</p> : (
            <dl className="space-y-1 text-sm">
              {methods.map((x) => <div key={x.method} className="flex justify-between"><dt>{PAYMENT_METHOD_LABEL[x.method] ?? x.method} ({x.count})</dt><dd><Money value={x.amount} /></dd></div>)}
              <div className="flex justify-between border-t border-line pt-1 font-semibold"><dt>Total</dt><dd><Money value={m.payments_received} /></dd></div>
            </dl>
          )}
        </Card>
        <Card title="Receivables now">
          <p className="text-2xl font-semibold"><Money value={m.outstanding} /></p>
          <p className="text-sm text-ink-muted">Overdue <Money value={m.overdue} /> · <Link href="/w/balances" className="link">See ageing</Link></p>
        </Card>
      </div>
      <Card title="Invoiced sales per day" className="mt-6">
        <DailyBarChart title="Invoiced sales per day" data={daily.map((d) => ({ day: d.day, value: d.invoiced }))} />
      </Card>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Top products (invoiced)" padded={false}>
          <table className="data-table">
            <thead><tr><th scope="col">Product</th><th scope="col" className="num">Quantity</th><th scope="col" className="num">Total</th></tr></thead>
            <tbody>
              {top.length === 0 ? <tr><td colSpan={3} className="text-ink-muted">No invoices in this period.</td></tr> : top.map((t) => (
                <tr key={t.description + t.unit_code}><td>{t.description}</td><td className="num">{formatQuantity(t.quantity, t.unit_code)}</td><td className="num"><Money value={t.total} /></td></tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="GST summary (outward supplies)" padded={false}>
          <table className="data-table">
            <thead><tr><th scope="col">Rate</th><th scope="col" className="num">Taxable</th><th scope="col" className="num">CGST</th><th scope="col" className="num">SGST</th><th scope="col" className="num">IGST</th></tr></thead>
            <tbody>
              {tax.length === 0 ? <tr><td colSpan={5} className="text-ink-muted">No invoices in this period.</td></tr> : tax.map((t) => (
                <tr key={t.tax_rate}><td>{Number(t.tax_rate)}%</td><td className="num"><Money value={t.taxable} /></td><td className="num"><Money value={t.cgst} /></td><td className="num"><Money value={t.sgst} /></td><td className="num"><Money value={t.igst} /></td></tr>
              ))}
            </tbody>
          </table>
          <p className="p-3 text-xs text-ink-muted">For your accountant. Credit notes are not netted here. This is not a GST return.</p>
        </Card>
      </div>
    </>
  );
}

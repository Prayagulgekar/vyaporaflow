import Link from "next/link";
import { ButtonLink, Card, EmptyState, Money, Notice, PageHeader, Pagination, Stat } from "@/components/ui";
import { HandoverStatusBadge } from "@/components/status";
import { addMoney } from "@/domain/money";
import { params, type SearchParams } from "@/features/shared/util";
import { PAYMENT_METHOD_LABEL, formatDate, formatDateTime, todayIST } from "@/lib/format";
import { cashSummary, listCashWorkers, listCollections, listCompanyRetailers, manualAdvances, normalizeCashFilters } from "@/server/collections";
import { requireWholesaler } from "@/server/viewer";

export default async function CashCollections({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const { viewer, company } = await requireWholesaler();
  const f = normalizeCashFilters(sp, todayIST());
  const [summary, page, workers, retailers] = await Promise.all([
    cashSummary(viewer.userId, company.companyId, f),
    listCollections(viewer.userId, company.companyId, f),
    listCashWorkers(viewer.userId, company.companyId),
    listCompanyRetailers(viewer.userId, company.companyId),
  ]);
  const advances = await manualAdvances(viewer.userId, company.companyId, [...new Set(page.rows.map((r) => r.retailer_id))]);
  const total = (k: "cash_collected" | "cash_handed_over" | "cash_pending" | "retailer_balance_due" | "order_value") => addMoney("0", ...summary.map((s) => s[k]));
  const pendingAll = addMoney("0", ...workers.map((w) => w.pending));
  const manager = company.role === "owner" || company.role === "manager";
  const filterParams = { ...sp, from: f.from, to: f.to };
  return (
    <>
      <PageHeader
        title="Cash Collections"
        description="Money your delivery staff collected from shops, and the cash they have handed to you. What a shop still owes is shown separately from the cash a worker is holding."
        actions={manager ? <ButtonLink href="/w/cash-collections/handover">Receive cash from a worker</ButtonLink> : null}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Cash with workers now" value={<Money value={pendingAll} />} hint="All dates. Collected in cash, not yet handed to you" tone={Number(pendingAll) > 0 ? "warn" : undefined} href="/w/cash-collections/handover" />
        <Stat label="Cash collected" value={<Money value={total("cash_collected")} />} hint={`${formatDate(f.from)} to ${formatDate(f.to)}`} />
        <Stat label="Cash handed over" value={<Money value={total("cash_handed_over")} />} hint="Of the cash collected in this period" />
        <Stat label="Shops still owe on these deliveries" value={<Money value={total("retailer_balance_due")} />} hint="Retailer balance, not cash with workers" />
      </div>

      <form className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-[auto_auto_1fr_1fr_1fr_1fr_auto]" role="search">
        <div><label htmlFor="from" className="label">From</label><input id="from" name="from" type="date" defaultValue={f.from} className="input" /></div>
        <div><label htmlFor="to" className="label">To</label><input id="to" name="to" type="date" defaultValue={f.to} className="input" /></div>
        <div><label htmlFor="worker" className="label">Delivery person</label>
          <select id="worker" name="worker" defaultValue={f.worker ?? ""} className="input"><option value="">Everyone</option>{workers.map((w) => <option key={w.user_id} value={w.user_id}>{w.full_name}</option>)}</select></div>
        <div><label htmlFor="retailer" className="label">Retailer</label>
          <select id="retailer" name="retailer" defaultValue={f.retailer ?? ""} className="input"><option value="">All retailers</option>{retailers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
        <div><label htmlFor="order" className="label">Order number</label><input id="order" name="order" defaultValue={f.order ?? ""} placeholder="e.g. SSB-000123" className="input" /></div>
        <div><label htmlFor="status" className="label">Collection status</label>
          <select id="status" name="status" defaultValue={f.status ?? ""} className="input">
            <option value="">Any</option>
            <option value="open">Cash still to hand over</option>
            <option value="pending">Pending handover</option>
            <option value="partially_handed_over">Partly handed over</option>
            <option value="handed_over">Handed over</option>
            <option value="not_required">Paid by UPI</option>
            <option value="no_payment">Nothing collected</option>
            <option value="reversed">Reversed</option>
          </select></div>
        <div className="flex items-end"><button className="btn btn-secondary w-full">Apply</button></div>
      </form>

      <Card title="By delivery person" padded={false}>
        {summary.length === 0 ? <div className="p-4"><EmptyState title="No deliveries or collections in this period" /></div> : (
          <table className="data-table stack">
            <thead><tr>
              <th scope="col">Delivery person</th><th scope="col" className="num">Deliveries</th><th scope="col" className="num">Order value</th>
              <th scope="col" className="num">Cash collected</th><th scope="col" className="num">Handed over</th><th scope="col" className="num">Pending handover</th>
              <th scope="col" className="num">Shops still owe</th><th scope="col"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.worker_id}>
                  <td data-label="Delivery person" className="font-medium">{s.worker_name}
                    {s.deliveries_without_collection > 0 ? <span className="block text-xs text-warn">{s.deliveries_without_collection} delivered with no payment recorded</span> : null}
                    {Number(s.upi_collected) > 0 ? <span className="block text-xs text-ink-muted">Also <Money value={s.upi_collected} /> by UPI</span> : null}
                  </td>
                  <td data-label="Deliveries" className="num">{s.completed_deliveries}</td>
                  <td data-label="Order value" className="num"><Money value={s.order_value} /></td>
                  <td data-label="Cash collected" className="num"><Money value={s.cash_collected} /></td>
                  <td data-label="Handed over" className="num"><Money value={s.cash_handed_over} /></td>
                  <td data-label="Pending handover" className="num font-semibold">
                    <Money value={s.cash_pending} />
                    {s.cash_pending_all_dates !== s.cash_pending ? <span className="block text-xs font-normal text-ink-muted">All dates: <Money value={s.cash_pending_all_dates} /></span> : null}
                  </td>
                  <td data-label="Shops still owe" className="num"><Money value={s.retailer_balance_due} /></td>
                  <td data-label="">
                    {manager && Number(s.cash_pending_all_dates) > 0 ? <Link href={`/w/cash-collections/handover?worker=${s.worker_id}`} className="btn btn-secondary btn-sm">Receive cash</Link> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="mt-2 text-xs text-ink-muted">
        Deliveries and order value count deliveries completed in the period. Cash columns count payments collected in the period. &quot;Shops still owe&quot; is what is still due on those orders; the Balances page shows each shop&apos;s full account.
      </p>

      {advances.length > 0 ? (
        <div className="mt-4">
          <Notice tone="warn" title="Check for cash counted twice">
            {advances.map((a) => <span key={a.retailer_id} className="block">{a.retailer_name} also has <Money value={a.unapplied} /> in payments recorded by the office that are not applied to any invoice.</span>)}
            If any of that was the same cash a delivery person has now recorded, reverse the office payment on its Payments page (with a reason). Nothing is changed automatically.
          </Notice>
        </div>
      ) : null}

      <Card title="Collections" className="mt-6" padded={false} actions={<Link href="/w/cash-collections/handover" className="link text-sm">Handover history</Link>}>
        {page.rows.length === 0 ? <div className="p-4"><EmptyState title="No collections match" /></div> : (
          <table className="data-table stack">
            <thead><tr>
              <th scope="col">Collected</th><th scope="col">Retailer and order</th><th scope="col">Delivery person</th><th scope="col">Receipt</th>
              <th scope="col" className="num">Amount</th><th scope="col">Cash status</th><th scope="col" className="num">Shop still owes</th>
            </tr></thead>
            <tbody>
              {page.rows.map((c) => (
                <tr key={c.collection_id}>
                  <td data-label="Collected"><Link href={`/w/cash-collections/${c.collection_id}`} className="link font-medium">{c.collection_number}</Link><span className="block text-xs text-ink-muted">{formatDateTime(c.collected_at)}</span></td>
                  <td data-label="Retailer and order">{c.retailer_name}<span className="block text-xs"><Link href={`/w/orders/${c.order_id}`} className="link">{c.order_number}</Link></span></td>
                  <td data-label="Delivery person">{c.worker_name ?? "–"}</td>
                  <td data-label="Receipt">{c.payment_id ? <Link href={`/w/payments/${c.payment_id}`} className="link">{c.payment_number}</Link> : "–"}{c.reference ? <span className="block text-xs text-ink-muted">Ref {c.reference}</span> : null}</td>
                  <td data-label="Amount" className="num"><Money value={c.amount} /><span className="block text-xs text-ink-muted">{PAYMENT_METHOD_LABEL[c.method] ?? c.method}</span></td>
                  <td data-label="Cash status"><HandoverStatusBadge status={c.handover_status} />{Number(c.pending_handover) > 0 && c.handover_status !== "pending" ? <span className="block text-xs text-warn"><Money value={c.pending_handover} /> still with worker</span> : null}</td>
                  <td data-label="Shop still owes" className="num">{c.balance_due_now === null ? "–" : <Money value={c.balance_due_now} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Pagination page={page.page} pageCount={page.pageCount} total={page.total} basePath="/w/cash-collections" params={filterParams} />
    </>
  );
}

import Link from "next/link";
import { DocumentShare } from "@/components/document-share";
import { Card, Money, Notice, PageHeader, Stat } from "@/components/ui";
import { compareMoney } from "@/domain/money";
import { orNotFound, params as flatParams, type SearchParams } from "@/features/shared/util";
import { formatDate, todayIST } from "@/lib/format";
import { accountStatementMessage, outstandingBalanceMessage } from "@/lib/whatsapp-messages";
import { AppError } from "@/server/errors";
import { loadBalanceDue, loadStatement, periodLabel, resolveStatementPeriod } from "@/server/documents";
import { userTx } from "@/server/rpc";
import { requireWholesaler } from "@/server/viewer";

export const metadata = { title: "Documents" };

export default async function RetailerDocumentsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const sp = await flatParams(searchParams);
  const { viewer, company } = await requireWholesaler();
  const rel = await userTx(viewer.userId, (q) =>
    q.query<{ id: string }>("select id from public.retailer_wholesaler_relationships where wholesaler_id = $1 and retailer_id = $2", [company.companyId, id]),
  ).catch(() => []);
  if (!rel[0]) return <Notice tone="warn">This retailer is not connected to {company.companyName}.</Notice>;

  const m = await orNotFound(loadBalanceDue(viewer.userId, company.companyId, id));
  const r = m.retailer;
  const greet = r.contact_name ?? r.name;
  const base = `/w/documents`;

  // Monthly or date-range statement, when one was asked for.
  let periodError: string | null = null;
  let period: Awaited<ReturnType<typeof loadStatement>> | null = null;
  let periodQuery = "";
  if (sp.month || sp.from || sp.to) {
    try {
      const range = resolveStatementPeriod({ month: sp.month, from: sp.from, to: sp.to });
      period = await loadStatement(viewer.userId, company.companyId, id, range);
      periodQuery = range.monthly ? `month=${sp.month}` : new URLSearchParams(Object.entries({ from: range.from ?? "", to: range.to ?? "" }).filter(([, v]) => v)).toString();
    } catch (err) {
      if (err instanceof AppError && err.kind === "validation") periodError = err.message;
      else throw err;
    }
  }
  const thisMonth = todayIST().slice(0, 7);

  return (
    <>
      <PageHeader
        eyebrow={<><Link href="/w/retailers" className="link">Retailers</Link> / <Link href={`/w/retailers/${id}`} className="link">{r.name}</Link></>}
        title="Documents and sharing"
        description={`Balance due and account statements for ${r.name}, as PDFs you can download, print or share on WhatsApp.`}
      />
      <div className="mb-6">
        <Notice tone="info" title="How WhatsApp sharing works">
          WhatsApp opens on {greet}&apos;s chat with the message typed in. On phones that support it, the PDF goes through your phone&apos;s share sheet. Otherwise the PDF downloads and you attach it in WhatsApp (paperclip, then Document). Nothing is sent until you press Send.
        </Notice>
      </div>

      <section id="balance" className="scroll-mt-20">
        <Card title="Balance due">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Outstanding" value={<Money value={m.outstanding} />} tone={compareMoney(m.outstanding, 0) > 0 ? "warn" : undefined} />
            <Stat label="Overdue" value={<Money value={m.overdue} />} tone={compareMoney(m.overdue, 0) > 0 ? "danger" : undefined} hint={m.oldestDueDate ? `Oldest due ${formatDate(m.oldestDueDate)}` : undefined} />
            <Stat label="Open invoices" value={m.openInvoices.length} />
            <Stat label="Advance not applied" value={<Money value={m.unapplied} />} />
          </div>
          <p className="mt-4 mb-3 text-sm text-ink-muted">A one-page summary: total invoiced, credit notes, payments received, outstanding and overdue amounts, and every open invoice with its due date. It is a statement, not a GST invoice.</p>
          <DocumentShare
            testId="share-balance-due"
            pdfUrl={`${base}/balance-due/${id}`}
            fallbackFilename="Balance-Due.pdf"
            title={`Balance due: ${r.name}`}
            phone={r.phone}
            recipientName={greet}
            message={outstandingBalanceMessage({ recipientName: greet, senderBusiness: m.wholesaler.name, outstanding: m.outstanding, overdue: m.overdue, oldestDueDate: m.oldestDueDate, unapplied: m.unapplied, asOf: m.asOf, attached: true })}
          />
        </Card>
      </section>

      <section id="statement" className="mt-6 scroll-mt-20">
        <Card title="Complete account statement">
          <p className="mb-3 text-sm text-ink-muted">Every invoice, credit note, payment and reversal with debit, credit and running balance, ending at {formatDate(m.asOf)}. Closing balance: <Money value={m.statementBalance} />.</p>
          <DocumentShare
            testId="share-statement"
            pdfUrl={`${base}/statement/${id}`}
            fallbackFilename="Account-Statement.pdf"
            title={`Account statement: ${r.name}`}
            phone={r.phone}
            recipientName={greet}
            message={accountStatementMessage({ recipientName: greet, senderBusiness: m.wholesaler.name, to: m.asOf, closingBalance: m.statementBalance, attached: true })}
          />
        </Card>
      </section>

      <section id="period" className="mt-6 scroll-mt-20">
        <Card title="Monthly or date-range statement">
          <div className="grid gap-6 md:grid-cols-2">
            <form method="get" action={`/w/retailers/${id}/documents#period`} className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label" htmlFor="month">Month</label>
                <input id="month" name="month" type="month" className="input" defaultValue={sp.month ?? thisMonth} max={thisMonth} required />
              </div>
              <button className="btn btn-secondary" type="submit">Prepare monthly statement</button>
            </form>
            <form method="get" action={`/w/retailers/${id}/documents#period`} className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label" htmlFor="from">From</label>
                <input id="from" name="from" type="date" className="input" defaultValue={sp.from ?? ""} required />
              </div>
              <div>
                <label className="label" htmlFor="to">To</label>
                <input id="to" name="to" type="date" className="input" defaultValue={sp.to ?? todayIST()} required />
              </div>
              <button className="btn btn-secondary" type="submit">Prepare statement</button>
            </form>
          </div>
          {periodError ? <div className="mt-4"><Notice tone="danger">{periodError}</Notice></div> : null}
          {period ? (
            <div className="mt-5 border-t border-line pt-4" data-testid="period-statement">
              <p className="mb-1 font-medium">{period.monthly ? "Monthly statement" : "Statement"}: {periodLabel(period.period)}</p>
              <p className="mb-3 text-sm text-ink-muted">
                Opening <Money value={period.period.opening} /> · debits <Money value={period.period.debit} /> · credits <Money value={period.period.credit} /> · closing <Money value={period.period.closing} /> · {period.period.lines.length} transactions
              </p>
              <DocumentShare
                key={periodQuery}
                testId="share-period"
                pdfUrl={`${base}/statement/${id}?${periodQuery}`}
                fallbackFilename="Statement.pdf"
                title={`Statement ${periodLabel(period.period)}: ${r.name}`}
                phone={r.phone}
                recipientName={greet}
                message={accountStatementMessage({ recipientName: greet, senderBusiness: m.wholesaler.name, from: period.period.from, to: period.period.to, openingBalance: period.period.opening, closingBalance: period.period.closing, attached: true })}
              />
            </div>
          ) : null}
        </Card>
      </section>
    </>
  );
}

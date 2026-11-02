import Link from "next/link";
import { RelationshipBadge } from "@/components/status";
import { ButtonLink, Card, DefinitionList, Money, Notice, PageHeader, Stat } from "@/components/ui";
import { ActionForm, ConfirmSubmit, SubmitButton, TextField } from "@/components/ui/client";
import { StatementTable } from "@/features/shared/statement";
import { orNotFound } from "@/features/shared/util";
import { decideRelationshipAction } from "@/features/wholesaler/actions";
import { WhatsAppComposer } from "@/components/whatsapp";
import { addMoney } from "@/domain/money";
import { retailerAccountOptions } from "@/features/shared/whatsapp-options";
import { todayIST } from "@/lib/format";
import { getStatement, openInvoices } from "@/server/billing";
import { listRetailers } from "@/server/relationships";
import { requireWholesaler } from "@/server/viewer";
import { userTx } from "@/server/rpc";

export default async function RetailerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { viewer, company } = await requireWholesaler();
  const rel = await userTx(viewer.userId, (q) =>
    q.query<{ id: string }>("select id from public.retailer_wholesaler_relationships where wholesaler_id = $1 and retailer_id = $2", [company.companyId, id]),
  ).catch(() => []);
  if (!rel[0]) return <Notice tone="warn">This retailer is not connected to {company.companyName}.</Notice>;
  const [statement, list, open] = await Promise.all([
    orNotFound(getStatement(viewer.userId, company.companyId, id)),
    listRetailers(viewer.userId, company.companyId, { pageSize: 500 }),
    openInvoices(viewer.userId, company.companyId, id),
  ]);
  const r = list.rows.find((x) => x.retailer_id === id)!;
  const overdueRows = open.filter((i) => i.payment_status === "overdue");
  const waOptions = retailerAccountOptions({
    recipientName: r.contact_name ?? r.name,
    business: company.companyName,
    outstanding: r.outstanding,
    unapplied: r.unapplied,
    overdue: addMoney("0", ...overdueRows.map((i) => i.due)),
    oldestDueDate: open.length ? open.map((i) => i.due_date).sort()[0]! : null,
    closingBalance: statement.totals.balance,
    asOf: todayIST(),
  });
  const manager = company.role === "owner" || company.role === "manager";
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/w/retailers" className="link">Retailers</Link>}
        title={r.name}
        description={[r.contact_name, r.phone, r.city].filter(Boolean).join(" · ")}
        actions={
          <>
            <RelationshipBadge status={r.status} />
            <WhatsAppComposer phone={r.phone} recipientName={r.contact_name ?? r.name} options={waOptions} />
            <ButtonLink href={`/w/retailers/${id}/documents#balance`} variant="secondary" size="sm">Send balance due</ButtonLink>
            <ButtonLink href={`/w/retailers/${id}/documents#statement`} variant="secondary" size="sm">Statements (PDF)</ButtonLink>
            <ButtonLink href={`/w/payments/new?retailer=${id}`} size="sm">Record payment</ButtonLink>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Outstanding" value={<Money value={r.outstanding} />} />
        <Stat label="Invoiced" value={<Money value={r.invoiced} />} />
        <Stat label="Received" value={<Money value={r.received} />} hint={Number(r.unapplied) > 0 ? <>Advance not yet applied: <Money value={r.unapplied} /></> : undefined} />
        <Stat label="Orders" value={r.total_orders} hint={`${r.delivered_orders} delivered · ${r.cancelled_orders} cancelled`} href={`/w/orders?q=${encodeURIComponent(r.name)}`} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <StatementTable lines={statement.lines} totals={statement.totals} />
        <Card title="Relationship">
          <DefinitionList items={[["Status", <RelationshipBadge key="s" status={r.status} />], ["Credit limit", r.credit_limit ? <Money key="c" value={r.credit_limit} /> : "No limit"]]} />
          {manager ? (
            <ActionForm action={decideRelationshipAction} className="mt-4 space-y-3">
              <input type="hidden" name="relationship_id" value={r.relationship_id} />
              <TextField name="credit_limit" label="Credit limit (₹)" inputMode="decimal" defaultValue={r.credit_limit ?? ""} hint="Blank means no limit. New orders above the limit are refused." />
              <TextField name="note" label="Note" />
              <SubmitButton name="decision" value="approved">{r.status === "approved" ? "Save" : "Approve"}</SubmitButton>
            </ActionForm>
          ) : null}
          {manager && r.status !== "blocked" ? (
            <ActionForm action={decideRelationshipAction} className="mt-4 border-t border-line pt-4">
              <input type="hidden" name="relationship_id" value={r.relationship_id} />
              <input type="hidden" name="decision" value="blocked" />
              <input type="hidden" name="credit_limit" value={r.credit_limit ?? ""} />
              <ConfirmSubmit label="Block retailer" variant="secondary" size="sm" title={`Block ${r.name}?`} body="They will no longer see your prices or be able to order. Existing orders and balances stay." confirmLabel="Block retailer" />
            </ActionForm>
          ) : null}
        </Card>
      </div>
    </>
  );
}

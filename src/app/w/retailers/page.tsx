import Link from "next/link";
import { RelationshipBadge } from "@/components/status";
import { Card, EmptyState, Money, PageHeader, Pagination } from "@/components/ui";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/client";
import { params, type SearchParams } from "@/features/shared/util";
import { decideRelationshipAction } from "@/features/wholesaler/actions";
import { formatDate } from "@/lib/format";
import { listRetailers } from "@/server/relationships";
import { requireWholesaler } from "@/server/viewer";

const TABS = [["", "All"], ["pending", "Requests"], ["approved", "Approved"], ["blocked", "Blocked"], ["rejected", "Declined"]] as const;

export default async function Retailers({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const { viewer, company } = await requireWholesaler();
  const page = await listRetailers(viewer.userId, company.companyId, sp);
  const pending = page.rows.filter((r) => r.status === "pending");
  return (
    <>
      <PageHeader title="Retailers" description="Shops that buy from you. Approve requests to let a shop see your prices and order." />
      <nav aria-label="Relationship status" className="mb-3 flex flex-wrap gap-1">
        {TABS.map(([k, label]) => (
          <Link key={k || "all"} href={`/w/retailers${k ? `?status=${k}` : ""}`} aria-current={(sp.status ?? "") === k ? "page" : undefined} className={`rounded-full border px-3 py-1 text-sm ${(sp.status ?? "") === k ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-surface text-ink-muted"}`}>
            {label}
          </Link>
        ))}
      </nav>
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]" role="search">
        <input type="hidden" name="status" value={sp.status ?? ""} />
        <label htmlFor="q" className="sr-only">Search retailers</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Search shop, contact or phone" className="input" />
        <label htmlFor="sort" className="sr-only">Sort</label>
        <select id="sort" name="sort" defaultValue={sp.sort ?? ""} className="input">
          <option value="">Requests first</option>
          <option value="name">Name</option>
          <option value="outstanding">Highest outstanding</option>
          <option value="last_order">Most recent order</option>
          <option value="orders">Most orders</option>
        </select>
        <button className="btn btn-secondary">Apply</button>
      </form>
      {pending.length ? (
        <div className="mb-6 space-y-3">
          {pending.map((r) => (
            <Card key={r.relationship_id} title={`Request from ${r.name}`}>
              <p className="text-sm text-ink-muted">
                {r.contact_name ?? ""} {r.phone ? `· ${r.phone}` : ""} {r.city ? `· ${r.city}` : ""} · asked on {formatDate(r.created_at)}
              </p>
              {r.request_note ? <p className="mt-2 rounded bg-sunken p-2 text-sm">“{r.request_note}”</p> : null}
              <ActionForm action={decideRelationshipAction} className="mt-3 flex flex-wrap items-end gap-3">
                <input type="hidden" name="relationship_id" value={r.relationship_id} />
                <div className="w-44"><TextField name="credit_limit" label="Credit limit (₹)" inputMode="decimal" hint="Optional" /></div>
                <SubmitButton name="decision" value="approved">Approve</SubmitButton>
                <SubmitButton name="decision" value="rejected" variant="secondary">Decline</SubmitButton>
              </ActionForm>
            </Card>
          ))}
        </div>
      ) : null}
      <Card padded={false}>
        {page.rows.length === 0 ? (
          <div className="p-4"><EmptyState title="No retailers yet">When shops find you in the marketplace and ask to connect, they appear here.</EmptyState></div>
        ) : (
          <table className="data-table stack">
            <thead>
              <tr>
                <th scope="col">Retailer</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">Orders</th>
                <th scope="col">Last order</th>
                <th scope="col" className="num">Credit limit</th>
                <th scope="col" className="num">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.map((r) => (
                <tr key={r.relationship_id}>
                  <td data-label="Retailer">
                    <Link href={`/w/retailers/${r.retailer_id}`} className="link font-medium">{r.name}</Link>
                    <span className="block text-xs text-ink-muted">{[r.contact_name, r.city].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td data-label="Status"><RelationshipBadge status={r.status} /></td>
                  <td data-label="Orders" className="num">{r.total_orders}</td>
                  <td data-label="Last order">{r.last_order_at ? formatDate(r.last_order_at) : "–"}</td>
                  <td data-label="Credit limit" className="num">{r.credit_limit ? <Money value={r.credit_limit} /> : "No limit"}</td>
                  <td data-label="Outstanding" className="num"><Money value={r.outstanding} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Pagination page={page.page} pageCount={page.pageCount} total={page.total} basePath="/w/retailers" params={sp} />
    </>
  );
}

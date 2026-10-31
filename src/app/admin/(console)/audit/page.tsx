import { Card, PageHeader, Pagination } from "@/components/ui";
import { params, type SearchParams } from "@/features/shared/util";
import { formatDateTime } from "@/lib/format";
import { listAudit } from "@/server/admin";
import { requireAdmin } from "@/server/viewer";

export default async function Audit({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const viewer = await requireAdmin();
  const page = await listAudit(viewer.userId, sp);
  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of sensitive changes: prices, payments, reversals, team, verification and suspension." />
      <form className="mb-4 flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">Filter by action</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Action, e.g. payment" className="input" />
        <button className="btn btn-secondary">Filter</button>
      </form>
      <Card padded={false}>
        <table className="data-table stack">
          <thead><tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">Who</th><th scope="col">Business</th><th scope="col">Details</th></tr></thead>
          <tbody>
            {page.rows.map((l) => (
              <tr key={l.id}>
                <td data-label="When">{formatDateTime(l.created_at)}</td>
                <td data-label="Action" className="font-mono text-xs">{l.action}</td>
                <td data-label="Who">{l.actor_name ?? "System"}</td>
                <td data-label="Business">{l.company_name ?? "–"}</td>
                <td data-label="Details" className="max-w-md font-mono text-xs break-all text-ink-muted">{JSON.stringify(l.details)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Pagination page={page.page} pageCount={page.pageCount} total={page.total} basePath="/admin/audit" params={sp} />
    </>
  );
}

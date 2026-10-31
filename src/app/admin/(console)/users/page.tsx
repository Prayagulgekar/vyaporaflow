import { Badge, Card, PageHeader, Pagination } from "@/components/ui";
import { params, type SearchParams } from "@/features/shared/util";
import { formatDate, humanize } from "@/lib/format";
import { listUsers } from "@/server/admin";
import { requireAdmin } from "@/server/viewer";

export default async function Users({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const viewer = await requireAdmin();
  const page = await listUsers(viewer.userId, sp);
  return (
    <>
      <PageHeader title="Users" description="Administrator access is granted only from the server command line (npm run admin:grant). It cannot be granted from this screen or by registration." />
      <form className="mb-4 flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">Search users</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Name or email" className="input" />
        <button className="btn btn-secondary">Search</button>
      </form>
      <Card padded={false}>
        <table className="data-table stack">
          <thead><tr><th scope="col">User</th><th scope="col">Account type</th><th scope="col">Businesses</th><th scope="col">Joined</th></tr></thead>
          <tbody>
            {page.rows.map((u) => (
              <tr key={u.id}>
                <td data-label="User">{u.full_name || "–"} {u.is_admin ? <Badge tone="info">Admin</Badge> : null}<span className="block text-xs text-ink-muted">{u.email}</span></td>
                <td data-label="Account type">{humanize(u.account_type ?? "not set")}</td>
                <td data-label="Businesses">{u.companies ?? "–"}</td>
                <td data-label="Joined">{formatDate(u.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Pagination page={page.page} pageCount={page.pageCount} total={page.total} basePath="/admin/users" params={sp} />
    </>
  );
}

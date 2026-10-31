import { PageHeader, Stat } from "@/components/ui";
import { adminOverview } from "@/server/admin";
import { requireAdmin } from "@/server/viewer";

export default async function AdminHome() {
  const viewer = await requireAdmin();
  const o = await adminOverview(viewer.userId);
  return (
    <>
      <PageHeader title="Platform overview" description="Counts from the live database." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Wholesalers" value={o.wholesalers} href="/admin/companies?kind=wholesaler" />
        <Stat label="Retailers" value={o.retailers} href="/admin/companies?kind=retailer" />
        <Stat label="Users" value={o.users} href="/admin/users" />
        <Stat label="Orders, last 30 days" value={o.orders_30d} />
        <Stat label="Awaiting verification" value={o.pending_verification} href="/admin/companies?verification=pending" tone={o.pending_verification ? "warn" : undefined} />
        <Stat label="Suspended businesses" value={o.suspended} href="/admin/companies?status=suspended" />
        <Stat label="Open support requests" value={o.open_support} href="/admin/support?status=open" tone={o.open_support ? "warn" : undefined} />
        <Stat label="Pending connection requests" value={o.relationships_pending} />
      </div>
    </>
  );
}

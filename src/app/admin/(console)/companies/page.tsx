import { Badge, Card, PageHeader, Pagination } from "@/components/ui";
import { VerificationBadge } from "@/components/status";
import { ActionForm, ConfirmSubmit, SubmitButton, TextField } from "@/components/ui/client";
import { companyStatusAction, verificationAction } from "@/features/admin/actions";
import { params, type SearchParams } from "@/features/shared/util";
import { formatDate } from "@/lib/format";
import { listCompanies } from "@/server/admin";
import { requireAdmin } from "@/server/viewer";

export default async function Companies({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const viewer = await requireAdmin();
  const page = await listCompanies(viewer.userId, sp);
  return (
    <>
      <PageHeader title="Businesses" description="Verify GSTIN and business details, and suspend businesses that break the terms. Every action is audited." />
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]" role="search">
        <label htmlFor="q" className="sr-only">Search</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Name or GSTIN" className="input" />
        <select name="kind" defaultValue={sp.kind ?? ""} className="input" aria-label="Type"><option value="">All types</option><option value="wholesaler">Wholesalers</option><option value="retailer">Retailers</option></select>
        <select name="status" defaultValue={sp.status ?? ""} className="input" aria-label="Status"><option value="">Any status</option><option value="active">Active</option><option value="suspended">Suspended</option></select>
        <select name="verification" defaultValue={sp.verification ?? ""} className="input" aria-label="Verification"><option value="">Any verification</option><option value="pending">Pending</option><option value="verified">Verified</option><option value="unverified">Unverified</option><option value="rejected">Rejected</option></select>
        <button className="btn btn-secondary">Apply</button>
      </form>
      <div className="space-y-3">
        {page.rows.map((c) => (
          <Card key={c.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{c.name} {c.is_demo ? <Badge>Demo data</Badge> : null}</p>
                <p className="text-sm text-ink-muted">{c.kind} · {c.city ?? "–"} · GSTIN {c.gstin ?? "none"} · {c.members} members · joined {formatDate(c.created_at)}</p>
                {c.status_reason ? <p className="text-sm text-danger">Suspended: {c.status_reason}</p> : null}
              </div>
              <div className="flex gap-1.5"><VerificationBadge status={c.verification_status} />{c.status === "suspended" ? <Badge tone="danger">Suspended</Badge> : <Badge tone="ok">Active</Badge>}</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              <ActionForm action={verificationAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="company_id" value={c.id} />
                <div className="w-48"><TextField name="note" label="Verification note" id={`n-${c.id}`} /></div>
                <SubmitButton name="status" value="verified" size="sm">Mark verified</SubmitButton>
                <SubmitButton name="status" value="rejected" size="sm" variant="secondary">Reject</SubmitButton>
              </ActionForm>
              <ActionForm action={companyStatusAction} className="flex items-end gap-2">
                <input type="hidden" name="company_id" value={c.id} />
                {c.status === "active" ? (
                  <>
                    <input type="hidden" name="status" value="suspended" />
                    <ConfirmSubmit label="Suspend" size="sm" title={`Suspend ${c.name}?`} body="Its members can still sign in and view records, but cannot place or change orders, stock or payments. It is hidden from the marketplace." confirmLabel="Suspend">
                      <TextField name="reason" label="Reason (shown to the business)" required id={`r-${c.id}`} />
                    </ConfirmSubmit>
                  </>
                ) : (
                  <>
                    <input type="hidden" name="status" value="active" />
                    <SubmitButton size="sm" variant="secondary">Reactivate</SubmitButton>
                  </>
                )}
              </ActionForm>
            </div>
          </Card>
        ))}
      </div>
      <Pagination page={page.page} pageCount={page.pageCount} total={page.total} basePath="/admin/companies" params={sp} />
    </>
  );
}

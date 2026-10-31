import { Badge, Card, EmptyState, PageHeader, Pagination } from "@/components/ui";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/client";
import { supportAction } from "@/features/admin/actions";
import { params, type SearchParams } from "@/features/shared/util";
import { formatDateTime, humanize } from "@/lib/format";
import { listSupport } from "@/server/admin";
import { requireAdmin } from "@/server/viewer";

export default async function Support({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const viewer = await requireAdmin();
  const page = await listSupport(viewer.userId, sp);
  return (
    <>
      <PageHeader title="Support requests" description="Messages from the contact form and from signed-in users. Reply by email; no email is sent from here." />
      <form className="mb-4 flex gap-2">
        <select name="status" defaultValue={sp.status ?? ""} className="input w-auto" aria-label="Status"><option value="">All</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="closed">Closed</option></select>
        <button className="btn btn-secondary">Apply</button>
      </form>
      {page.rows.length === 0 ? <EmptyState title="No support requests" /> : (
        <div className="space-y-3">
          {page.rows.map((s) => (
            <Card key={s.id}>
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-semibold">{s.name} <span className="font-normal text-ink-muted">&lt;{s.email}&gt; {s.phone ?? ""}</span></p>
                <Badge tone={s.status === "open" ? "warn" : s.status === "closed" ? "neutral" : "progress"}>{humanize(s.status)}</Badge>
              </div>
              <p className="text-xs text-ink-muted">{humanize(s.topic)} · {humanize(s.source)} · {formatDateTime(s.created_at)}{s.company_name ? ` · ${s.company_name}` : ""}</p>
              <p className="mt-2 text-sm whitespace-pre-wrap">{s.message}</p>
              {s.admin_note ? <p className="mt-2 rounded bg-sunken p-2 text-sm">Note: {s.admin_note}</p> : null}
              <ActionForm action={supportAction} className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={s.id} />
                <div className="w-64"><TextField name="note" label="Internal note" id={`note-${s.id}`} defaultValue={s.admin_note ?? ""} /></div>
                <SubmitButton name="status" value="in_progress" size="sm" variant="secondary">In progress</SubmitButton>
                <SubmitButton name="status" value="closed" size="sm">Close</SubmitButton>
              </ActionForm>
            </Card>
          ))}
        </div>
      )}
      <Pagination page={page.page} pageCount={page.pageCount} total={page.total} basePath="/admin/support" params={sp} />
    </>
  );
}

import { Card, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/client";
import { settingAction } from "@/features/admin/actions";
import { formatDateTime } from "@/lib/format";
import { listSettings } from "@/server/admin";
import { requireAdmin } from "@/server/viewer";

export default async function PlatformSettings() {
  await requireAdmin();
  const settings = await listSettings();
  return (
    <>
      <PageHeader title="Platform settings" description="Values are JSON: numbers as 50, text in double quotes, lists as [10, 25]." />
      <div className="space-y-3">
        {settings.map((s) => (
          <Card key={s.key}>
            <ActionForm action={settingAction} className="grid gap-3 sm:grid-cols-[1fr_16rem_auto] sm:items-end">
              <input type="hidden" name="key" value={s.key} />
              <div><p className="font-mono text-sm">{s.key}</p><p className="text-sm text-ink-muted">{s.description}</p><p className="text-xs text-ink-faint">Updated {formatDateTime(s.updated_at)}</p></div>
              <TextField name="value" label="Value" id={`v-${s.key}`} defaultValue={JSON.stringify(s.value)} />
              <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
            </ActionForm>
          </Card>
        ))}
      </div>
    </>
  );
}

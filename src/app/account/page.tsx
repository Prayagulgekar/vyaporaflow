import Link from "next/link";
import { DemoBanner, Logo } from "@/components/brand";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/ui/client";
import { updateProfileAction } from "@/features/auth/actions";
import { LANGUAGES } from "@/features/shared/company-forms";
import { isDemoMode } from "@/lib/env";
import { homePathFor, requireViewer } from "@/server/viewer";
import { humanize } from "@/lib/format";

export default async function Account() {
  const viewer = await requireViewer("/account");
  return (
    <div className="min-h-screen">
      {isDemoMode() ? <DemoBanner /> : null}
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between"><Logo href="/" /><Link href={homePathFor(viewer)} className="link text-sm">Back to my workspace</Link></div>
        <main id="main">
          <PageHeader title="My account" description={viewer.email} />
          <Card title="Personal details">
            <ActionForm action={updateProfileAction} className="space-y-4">
              <TextField name="full_name" label="Full name" required defaultValue={viewer.fullName} />
              <TextField name="phone" label="Mobile number" type="tel" defaultValue={viewer.phone ?? ""} />
              <SelectField name="preferred_language" label="Preferred language" defaultValue={viewer.preferredLanguage}>
                {LANGUAGES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </SelectField>
              <SubmitButton>Save</SubmitButton>
            </ActionForm>
          </Card>
          <Card title="Businesses" className="mt-6">
            {viewer.memberships.length === 0 ? <p className="text-sm text-ink-muted">You are not part of a business yet. <Link href="/onboarding" className="link">Set one up</Link>.</p> : (
              <ul className="space-y-1 text-sm">{viewer.memberships.map((m) => <li key={m.membershipId}>{m.companyName} · {humanize(m.companyKind)} · {humanize(m.role)}</li>)}</ul>
            )}
          </Card>
          <Card title="Password" className="mt-6">
            <p className="text-sm text-ink-muted">To change your password, use <Link href="/forgot-password" className="link">reset password</Link>.</p>
          </Card>
        </main>
      </div>
    </div>
  );
}

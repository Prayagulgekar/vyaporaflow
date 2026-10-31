import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DemoBanner, Logo } from "@/components/brand";
import { Notice } from "@/components/ui";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/client";
import { adminLoginAction } from "@/features/auth/actions";
import { isDemoMode } from "@/lib/env";
import { getViewer } from "@/server/viewer";

export const metadata: Metadata = { title: "Admin sign in" };

/**
 * Sign-in page for platform administrators. There is deliberately no admin
 * sign-up: access is granted only with `npm run admin:grant`.
 */
export default async function AdminLogin({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  const viewer = await getViewer().catch(() => null);
  if (viewer?.isAdmin) redirect("/admin");
  return (
    <div className="min-h-screen">
      {isDemoMode() ? <DemoBanner /> : null}
      <div className="mx-auto flex max-w-md flex-col px-4 py-10">
        <Logo href="/" />
        <main id="main" className="mt-8">
          <h1 className="font-display text-3xl">Admin sign in</h1>
          <p className="mt-1 text-sm text-ink-muted">
            For VyaporaFlow platform administrators only. Wholesalers, retailers and delivery staff{" "}
            <Link href="/login" className="link">sign in here</Link>.
          </p>
          {viewer ? (
            <div className="mt-4">
              <Notice tone="warn">
                You are signed in as {viewer.email}, which is not an administrator account. Signing in below replaces that session.
              </Notice>
            </div>
          ) : null}
          <ActionForm action={adminLoginAction} className="card mt-6 space-y-4 p-5">
            <input type="hidden" name="next" value={sp.next ?? ""} />
            <TextField name="email" label="Admin email" type="email" autoComplete="email" required />
            <TextField name="password" label="Password" type="password" autoComplete="current-password" required />
            <div className="flex items-center justify-between">
              <SubmitButton pendingLabel="Signing in…">Sign in to admin</SubmitButton>
              <Link href="/forgot-password" className="link text-sm">
                Forgot password?
              </Link>
            </div>
          </ActionForm>
          <p className="mt-4 text-sm text-ink-muted">
            There is no admin sign-up. An existing account becomes an administrator only when someone with database access runs{" "}
            <code className="rounded bg-sunken px-1">npm run admin:grant -- email</code>.
          </p>
          {isDemoMode() ? (
            <div className="mt-6 rounded-lg border border-line bg-surface p-4 text-sm">
              <p className="font-semibold">Demo administrator</p>
              <p className="mt-1 text-ink-muted">
                <code className="text-xs">admin@vyaporaflow.test</code> with the password{" "}
                <code className="rounded bg-sunken px-1">VyaporaDemo#2026</code>. Fictional demo data only.
              </p>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}

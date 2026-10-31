import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/ui";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/client";
import { loginAction } from "@/features/auth/actions";
import { getViewer, homePathFor } from "@/server/viewer";

export const metadata: Metadata = { title: "Sign in" };

const DEMO_ACCOUNTS = [
  ["Wholesaler (owner)", "sahyadri.owner@vyaporaflow.test"],
  ["Wholesaler (staff)", "sahyadri.staff@vyaporaflow.test"],
  ["Retailer", "ganesh.retailer@vyaporaflow.test"],
  ["Delivery", "ravi.delivery@vyaporaflow.test"],
  ["Platform admin", "admin@vyaporaflow.test"],
];

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  const viewer = await getViewer().catch(() => null);
  if (viewer) redirect(homePathFor(viewer));
  return (
    <>
      <h1 className="font-display text-3xl">Sign in</h1>
      <p className="mt-1 text-sm text-ink-muted">
        New to VyaporaFlow? <Link href="/register" className="link">Create an account</Link>
      </p>
      {sp.reset ? (
        <div className="mt-4">
          <Notice tone="ok">Your password was changed. Sign in with the new password.</Notice>
        </div>
      ) : null}
      <ActionForm action={loginAction} className="card mt-6 space-y-4 p-5">
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <TextField name="email" label="Email" type="email" autoComplete="email" required />
        <TextField name="password" label="Password" type="password" autoComplete="current-password" required />
        <div className="flex items-center justify-between">
          <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
          <Link href="/forgot-password" className="link text-sm">
            Forgot password?
          </Link>
        </div>
      </ActionForm>
      <p className="mt-4 text-center text-sm text-ink-muted">
        Platform administrator? <Link href="/admin/login" className="link">Admin sign in</Link>
      </p>
    </>
  );
}

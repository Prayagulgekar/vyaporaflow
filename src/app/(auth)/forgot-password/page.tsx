export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, ResultData, SubmitButton, TextField, UnlessOk } from "@/components/ui/client";
import { forgotPasswordAction } from "@/features/auth/actions";
import { isDemoMode } from "@/lib/env";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPassword() {
  const demo = isDemoMode();
  return (
    <>
      <h1 className="font-display text-3xl">Reset your password</h1>
      <p className="mt-1 text-sm text-ink-muted">Enter the email address you registered with.</p>
      <ActionForm action={forgotPasswordAction} className="card mt-6 space-y-4 p-5">
        {demo ? <ResultData field="simulatedLink" label="Demo mode has no email service. Simulated reset link:" as="link" prefixOrigin /> : null}
        <UnlessOk>
          <TextField name="email" label="Email" type="email" autoComplete="email" required />
          <SubmitButton pendingLabel="Sending…">Send reset link</SubmitButton>
        </UnlessOk>
      </ActionForm>
      <p className="mt-4 text-sm">
        <Link href="/login" className="link">Back to sign in</Link>
      </p>
    </>
  );
}

import type { Metadata } from "next";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/client";
import { resetPasswordAction } from "@/features/auth/actions";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <>
      <h1 className="font-display text-3xl">Choose a new password</h1>
      <ActionForm action={resetPasswordAction} className="card mt-6 space-y-4 p-5">
        <input type="hidden" name="token" value={token ?? ""} />
        <TextField name="password" label="New password" type="password" autoComplete="new-password" required hint="At least 10 characters, with letters and a number." />
        <TextField name="confirm" label="Repeat the new password" type="password" autoComplete="new-password" required />
        <SubmitButton>Save new password</SubmitButton>
      </ActionForm>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, FieldErrorText, SubmitButton, TextField, UnlessOk } from "@/components/ui/client";
import { registerAction } from "@/features/auth/actions";

export const metadata: Metadata = { title: "Create an account" };

const TYPES = [
  { value: "wholesaler", title: "I run a wholesale or distribution business", hint: "Manage products, orders, stock, delivery and payments." },
  { value: "retailer", title: "I run a shop and buy from wholesalers", hint: "Find wholesalers and order stock." },
  { value: "delivery_worker", title: "I deliver for a wholesaler", hint: "Your employer will invite you to their business." },
];

export default async function Register({ searchParams }: { searchParams: Promise<{ type?: string; invite?: string; email?: string }> }) {
  const sp = await searchParams;
  const preset = TYPES.some((t) => t.value === sp.type) ? sp.type : sp.invite ? "delivery_worker" : "wholesaler";
  return (
    <>
      <h1 className="font-display text-3xl">Create your account</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Already registered? <Link href="/login" className="link">Sign in</Link>
      </p>
      <ActionForm action={registerAction} className="card mt-6 space-y-4 p-5">
        <UnlessOk>
          <input type="hidden" name="invite" value={sp.invite ?? ""} />
          <fieldset>
            <legend className="label">How will you use VyaporaFlow?</legend>
            <div className="space-y-2">
              {TYPES.map((t) => (
                <label key={t.value} className="flex cursor-pointer gap-3 rounded-md border border-line p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                  <input type="radio" name="account_type" value={t.value} defaultChecked={preset === t.value} className="mt-1 accent-accent" />
                  <span>
                    <span className="block text-sm font-medium">{t.title}</span>
                    <span className="block text-xs text-ink-muted">{t.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <FieldErrorText name="account_type" />
          </fieldset>
          <TextField name="full_name" label="Your full name" autoComplete="name" required />
          <TextField name="email" label="Email" type="email" autoComplete="email" required defaultValue={sp.email} />
          <TextField name="password" label="Password" type="password" autoComplete="new-password" required hint="At least 10 characters, with letters and a number." />
          <p className="text-xs text-ink-muted">
            By creating an account you agree to the <Link href="/terms" className="link">terms of use</Link> and <Link href="/privacy" className="link">privacy policy</Link>.
          </p>
          <SubmitButton pendingLabel="Creating account…">Create account</SubmitButton>
        </UnlessOk>
      </ActionForm>
    </>
  );
}

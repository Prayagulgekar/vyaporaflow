import type { Metadata } from "next";
import { PageIntro, Section } from "@/components/marketing";
import { ActionForm, SelectField, SubmitButton, TextareaField, TextField, UnlessOk } from "@/components/ui/client";
import { contactAction } from "@/features/shared/actions";
import { listSettings } from "@/server/admin";

export const metadata: Metadata = { title: "Contact" };

export default async function Contact({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  const { topic } = await searchParams;
  const settings = await listSettings().catch(() => []);
  const supportEmail = settings.find((s) => s.key === "support_email")?.value;
  return (
    <>
      <PageIntro eyebrow="Contact" title="Talk to the VyaporaFlow team.">
        Questions about pricing, setting up your business, or a problem with your account. Messages are read by the platform team.
      </PageIntro>
      <Section>
        <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr]">
          <ActionForm action={contactAction} className="card space-y-4 p-6" resetOnSuccess>
            <UnlessOk>
              <TextField name="name" label="Your name" required autoComplete="name" />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField name="email" label="Email" type="email" required autoComplete="email" />
                <TextField name="phone" label="Mobile number" type="tel" inputMode="tel" autoComplete="tel" hint="Optional" />
              </div>
              <SelectField name="topic" label="Topic" required defaultValue={topic === "pricing" ? "sales" : "support"}>
                <option value="sales">Pricing and plans</option>
                <option value="support">Help with my account</option>
                <option value="partnership">Partnership</option>
                <option value="other">Something else</option>
              </SelectField>
              <TextareaField name="message" label="Message" required rows={5} />
              <div className="hidden" aria-hidden>
                <label htmlFor="website">Website</label>
                <input id="website" name="website" tabIndex={-1} autoComplete="off" />
              </div>
              <SubmitButton pendingLabel="Sending…">Send message</SubmitButton>
            </UnlessOk>
          </ActionForm>
          <div className="space-y-4 text-sm text-ink-muted">
            <p>We reply by email. This form does not send an automatic confirmation email.</p>
            {typeof supportEmail === "string" && !supportEmail.endsWith("@example.com") ? (
              <p>
                You can also write to <span className="font-medium text-ink">{supportEmail}</span>.
              </p>
            ) : null}
            <p>Please do not send passwords, card numbers or bank details through this form.</p>
          </div>
        </div>
      </Section>
    </>
  );
}

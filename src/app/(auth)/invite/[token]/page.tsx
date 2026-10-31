import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { acceptInviteAction } from "@/features/auth/actions";
import { previewInvitation } from "@/server/companies";
import { getViewer } from "@/server/viewer";
import { humanize } from "@/lib/format";

export const metadata: Metadata = { title: "Team invitation" };

export default async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invite, viewer] = await Promise.all([previewInvitation(token), getViewer()]);
  if (!invite || !invite.usable) {
    return (
      <>
        <h1 className="font-display text-3xl">Invitation not valid</h1>
        <p className="mt-2 text-ink-muted">This invitation link has expired, was already used, or was cancelled. Ask the business owner for a new link.</p>
      </>
    );
  }
  return (
    <>
      <h1 className="font-display text-3xl">Join {invite.company_name}</h1>
      <p className="mt-2 text-ink-muted">
        You have been invited as <strong className="text-ink">{humanize(invite.role)}</strong> using the email <strong className="text-ink">{invite.email}</strong>.
      </p>
      {viewer ? (
        viewer.email.toLowerCase() === invite.email.toLowerCase() ? (
          <ActionForm action={acceptInviteAction} className="mt-6">
            <input type="hidden" name="token" value={token} />
            <SubmitButton pendingLabel="Joining…">Accept invitation</SubmitButton>
          </ActionForm>
        ) : (
          <div className="mt-6">
            <Notice tone="warn">You are signed in as {viewer.email}. Sign out and sign in with {invite.email} to accept.</Notice>
          </div>
        )
      ) : (
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href={`/register?invite=${token}&email=${encodeURIComponent(invite.email)}${invite.role === "delivery_worker" ? "&type=delivery_worker" : ""}`} className="btn btn-primary">
            Create an account
          </Link>
          <Link href={`/login?next=/invite/${token}`} className="btn btn-secondary">
            I already have an account
          </Link>
        </div>
      )}
    </>
  );
}

import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { ActionForm, ConfirmSubmit, ResultData, SelectField, SubmitButton, TextField } from "@/components/ui/client";
import { inviteMemberAction, memberStatusAction } from "@/features/wholesaler/actions";
import { formatDate, humanize } from "@/lib/format";
import { listInvitations, listMembers } from "@/server/companies";
import { requireWholesaler } from "@/server/viewer";

export default async function Settings() {
  const { viewer, company } = await requireWholesaler();
  const manager = company.role === "owner" || company.role === "manager";
  if (!manager) return (<><PageHeader title="Team and settings" /><Notice tone="info">Only owners and managers can manage the team.</Notice></>);
  const [members, invites] = await Promise.all([listMembers(viewer.userId, company.companyId), listInvitations(viewer.userId, company.companyId)]);
  return (
    <>
      <PageHeader title="Team and settings" description="Invite managers, office staff and delivery staff. Each person signs in with their own account." />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card title="Team" padded={false}>
          <table className="data-table stack">
            <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.membership_id}>
                  <td data-label="Name">{m.full_name}<span className="block text-xs text-ink-muted">{m.email}</span></td>
                  <td data-label="Role">{humanize(m.role)}</td>
                  <td data-label="Status">{m.status === "active" ? <Badge tone="ok">Active</Badge> : <Badge>Removed</Badge>}</td>
                  <td data-label="Actions">
                    {m.role !== "owner" && m.user_id !== viewer.userId ? (
                      <ActionForm action={memberStatusAction}>
                        <input type="hidden" name="membership_id" value={m.membership_id} />
                        <input type="hidden" name="status" value={m.status === "active" ? "removed" : "active"} />
                        {m.status === "active" ? (
                          <ConfirmSubmit label="Remove" size="sm" variant="secondary" title={`Remove ${m.full_name}?`} body="They lose access to this business immediately. Their past actions stay in the history. Open deliveries assigned to them must be reassigned." confirmLabel="Remove" />
                        ) : <SubmitButton size="sm" variant="secondary">Restore</SubmitButton>}
                      </ActionForm>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Invite someone">
          <ActionForm action={inviteMemberAction} className="space-y-3">
            <ResultData field="inviteLink" label="One-time invitation link" prefixOrigin />
            <TextField name="email" label="Their email" type="email" required />
            <TextField name="full_name" label="Their name" />
            <SelectField name="role" label="Role" defaultValue="delivery_worker">
              <option value="delivery_worker">Delivery staff: sees only deliveries assigned to them</option>
              <option value="staff">Office staff: orders, stock, delivery and recording payments (cannot change prices)</option>
              {company.role === "owner" ? <option value="manager">Manager: everything except removing the owner</option> : null}
            </SelectField>
            <SubmitButton>Create invitation</SubmitButton>
            <p className="text-xs text-ink-muted">VyaporaFlow does not send the invitation email. Copy the link and share it with the person by WhatsApp, SMS or email.</p>
          </ActionForm>
        </Card>
      </div>
      <Card title="Invitations" className="mt-6" padded={false}>
        <table className="data-table stack">
          <thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {invites.length === 0 ? <tr><td colSpan={3} className="text-ink-muted">No invitations yet.</td></tr> : invites.map((i) => (
              <tr key={i.id}>
                <td data-label="Email">{i.email}</td>
                <td data-label="Role">{humanize(i.role)}</td>
                <td data-label="Status">{i.accepted_at ? <Badge tone="ok">Accepted {formatDate(i.accepted_at)}</Badge> : i.revoked_at ? <Badge>Revoked</Badge> : new Date(i.expires_at) < new Date() ? <Badge tone="warn">Expired</Badge> : <Badge tone="info">Waiting · expires {formatDate(i.expires_at)}</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

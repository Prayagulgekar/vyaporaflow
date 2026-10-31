import Link from "next/link";
import { VerificationBadge } from "@/components/status";
import { Badge, Card, Checkbox, Notice, PageHeader } from "@/components/ui";
import { ActionForm, SelectField, SubmitButton, TextareaField, TextField } from "@/components/ui/client";
import { AddressForm, CompanyDetailsForm } from "@/features/shared/company-forms";
import { addZoneAction, requestVerificationAction, updateAddressAction, updateCompanyAction, updateSettingsAction, zoneToggleAction } from "@/features/wholesaler/actions";
import { getCompanyProfile, listStates, listZones } from "@/server/companies";
import { imageUrl } from "@/server/storage";
import { requireWholesaler } from "@/server/viewer";

const DAYS = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]] as const;

export default async function Profile() {
  const { viewer, company } = await requireWholesaler();
  const [c, states, zones] = await Promise.all([getCompanyProfile(viewer.userId, company.companyId), listStates(), listZones(viewer.userId, company.companyId)]);
  const w = c.wholesaler!;
  const manager = company.role === "owner" || company.role === "manager";
  if (!manager) {
    return (
      <>
        <PageHeader title="Business profile" />
        <Notice tone="info">Only owners and managers can change the business profile.</Notice>
      </>
    );
  }
  return (
    <>
      <PageHeader title="Business profile" description={<>How retailers see you. Public page: <Link href={`/marketplace/${c.slug}`} className="link">/marketplace/{c.slug}</Link></>} actions={<VerificationBadge status={c.verification_status} />} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Business details"><CompanyDetailsForm action={updateCompanyAction} c={c} logoUrl={imageUrl(c.logo_path)} /></Card>
        <Card title="Address and location"><AddressForm action={updateAddressAction} a={c.address} states={states} /></Card>
      </div>
      <Card title="Ordering, delivery and hours" className="mt-6">
        <ActionForm action={updateSettingsAction} className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <TextField name="business_category" label="What you sell" required defaultValue={w.business_category} />
            <TextareaField name="description" label="About your business" rows={3} defaultValue={w.description ?? ""} hint="Shown on your marketplace page" />
            <div className="grid grid-cols-2 gap-4">
              <TextField name="min_order_value" label="Minimum order (₹)" inputMode="decimal" defaultValue={w.min_order_value} />
              <TextField name="payment_terms_days" label="Payment terms (days)" type="number" min={0} max={180} defaultValue={String(w.payment_terms_days)} />
              <TextField name="delivery_charge" label="Delivery charge (₹)" inputMode="decimal" defaultValue={w.delivery_charge} />
              <TextField name="free_delivery_above" label="Free delivery above (₹)" inputMode="decimal" defaultValue={w.free_delivery_above ?? ""} />
            </div>
            <TextField name="whatsapp_number" label="WhatsApp number" type="tel" defaultValue={w.whatsapp_number ?? ""} hint="Retailers get a link that opens a WhatsApp chat with you. No messages are sent automatically." />
            <Checkbox name="offers_delivery" label="We deliver to retailers" defaultChecked={w.offers_delivery} hint="Turn off for pickup only" />
            <Checkbox name="auto_approve_retailers" label="Approve new retailers automatically" defaultChecked={w.auto_approve_retailers} />
            <Checkbox name="is_listed" label="List my business in the marketplace" defaultChecked={w.is_listed} />
          </div>
          <fieldset>
            <legend className="label">Opening hours (India time)</legend>
            <div className="space-y-2">
              {DAYS.map(([k, label]) => {
                const h = w.opening_hours?.[k];
                return (
                  <div key={k} className="grid grid-cols-[7rem_auto_1fr_1fr] items-center gap-2 text-sm">
                    <span>{label}</span>
                    <label className="flex items-center gap-1"><input type="checkbox" name={`hours.${k}.on`} defaultChecked={!!h} className="accent-accent" /> Open</label>
                    <input type="time" name={`hours.${k}.open`} defaultValue={h?.[0] ?? "09:00"} className="input" aria-label={`${label} opening time`} />
                    <input type="time" name={`hours.${k}.close`} defaultValue={h?.[1] ?? "19:00"} className="input" aria-label={`${label} closing time`} />
                  </div>
                );
              })}
            </div>
            <div className="mt-6"><SubmitButton>Save ordering settings</SubmitButton></div>
          </fieldset>
        </ActionForm>
      </Card>
      <Card title="Delivery coverage" className="mt-6">
        <p className="mb-3 text-sm text-ink-muted">Where you deliver. This is separate from how far retailers search: a shop 40 km away can find you, but sees &ldquo;outside delivery area&rdquo; unless a zone covers it.</p>
        {zones.length ? (
          <ul className="mb-4 divide-y divide-line rounded-md border border-line">
            {zones.map((z) => (
              <li key={z.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <span>
                  <strong>{z.name}</strong> · {z.kind === "radius" ? `within ${Number(z.radius_km)} km` : `${z.pincodes.length} PIN codes: ${z.pincodes.slice(0, 8).join(", ")}${z.pincodes.length > 8 ? "…" : ""}`}{" "}
                  {z.is_active ? <Badge tone="ok">Active</Badge> : <Badge>Paused</Badge>}
                </span>
                <form action={zoneToggleAction} className="flex gap-2">
                  <input type="hidden" name="zone_id" value={z.id} />
                  <button name="op" value={z.is_active ? "pause" : "activate"} className="btn btn-secondary btn-sm">{z.is_active ? "Pause" : "Activate"}</button>
                  <button name="op" value="delete" className="btn btn-ghost btn-sm text-danger">Delete</button>
                </form>
              </li>
            ))}
          </ul>
        ) : <p className="mb-4 text-sm">No delivery zones yet. Orders from any location will show as &ldquo;delivery to be confirmed&rdquo;.</p>}
        <ActionForm action={addZoneAction} className="grid gap-3 sm:grid-cols-[1fr_10rem_1fr_auto] sm:items-end" resetOnSuccess>
          <TextField name="name" label="Zone name" required placeholder="e.g. Pune city" />
          <SelectField name="kind" label="Type" defaultValue="radius">
            <option value="radius">Radius (km)</option>
            <option value="pincodes">PIN code list</option>
          </SelectField>
          <div className="grid grid-cols-2 gap-2">
            <TextField name="radius_km" label="Radius km" inputMode="decimal" />
            <TextField name="pincodes" label="PIN codes" placeholder="411001, 411038" />
          </div>
          <SubmitButton variant="secondary">Add zone</SubmitButton>
        </ActionForm>
      </Card>
      <Card title="Verification" className="mt-6">
        <p className="text-sm text-ink-muted">A verified badge tells retailers that the platform team checked your GSTIN and business details. It is not a government certification.</p>
        {c.verification_status === "unverified" || c.verification_status === "rejected" ? (
          <ActionForm action={requestVerificationAction} className="mt-3">
            <SubmitButton variant="secondary">Request verification</SubmitButton>
          </ActionForm>
        ) : <p className="mt-3 text-sm"><VerificationBadge status={c.verification_status} /></p>}
      </Card>
    </>
  );
}

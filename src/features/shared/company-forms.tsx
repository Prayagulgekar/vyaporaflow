import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/ui/client";
import type { ActionState } from "@/lib/action-state";
import type { CompanyProfile } from "@/server/companies";
import { LocationButton } from "./location-button";

type Action = (s: ActionState, fd: FormData) => Promise<ActionState>;

export const LANGUAGES = [
  ["en", "English"],
  ["hi", "हिन्दी (Hindi)"],
  ["mr", "मराठी (Marathi)"],
  ["gu", "ગુજરાતી (Gujarati)"],
  ["ta", "தமிழ் (Tamil)"],
  ["te", "తెలుగు (Telugu)"],
  ["kn", "ಕನ್ನಡ (Kannada)"],
  ["bn", "বাংলা (Bengali)"],
] as const;

export function CompanyDetailsForm({ action, c, logoUrl }: { action: Action; c: CompanyProfile; logoUrl: string | null }) {
  return (
    <ActionForm action={action} className="space-y-4">
      <TextField name="name" label="Business name" required defaultValue={c.name} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="contact_name" label="Contact person" defaultValue={c.contact_name ?? ""} />
        <TextField name="phone" label="Phone" type="tel" defaultValue={c.phone ?? ""} />
        <TextField name="email" label="Email" type="email" defaultValue={c.email ?? ""} />
        <TextField name="gstin" label="GSTIN" defaultValue={c.gstin ?? ""} className="uppercase" maxLength={15} />
      </div>
      <SelectField name="preferred_language" label="Preferred language" defaultValue={c.preferred_language}>
        {LANGUAGES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </SelectField>
      <div className="flex items-center gap-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="Current logo" className="size-14 rounded border border-line object-cover" />
        ) : null}
        <div>
          <label htmlFor="image" className="label">Logo</label>
          <input id="image" name="image" type="file" accept="image/png,image/jpeg,image/webp" className="text-sm" />
          <p className="hint">PNG, JPEG or WebP, up to 2 MB.</p>
        </div>
      </div>
      <SubmitButton>Save details</SubmitButton>
    </ActionForm>
  );
}

export function AddressForm({ action, a, states }: { action: Action; a: CompanyProfile["address"]; states: { code: string; name: string }[] }) {
  return (
    <ActionForm action={action} className="space-y-4">
      <TextField name="line1" label="Shop or building, street" required defaultValue={a?.line1 ?? ""} />
      <TextField name="line2" label="Area or landmark" defaultValue={a?.line2 ?? ""} />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField name="city" label="City" required defaultValue={a?.city ?? ""} />
        <SelectField name="state_code" label="State" defaultValue={a?.state_code ?? "27"}>
          {states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
        </SelectField>
        <TextField name="pincode" label="PIN code" inputMode="numeric" maxLength={6} required defaultValue={a?.pincode ?? ""} />
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <TextField name="latitude" label="Latitude" inputMode="decimal" defaultValue={a?.latitude ?? ""} />
        <TextField name="longitude" label="Longitude" inputMode="decimal" defaultValue={a?.longitude ?? ""} />
        <LocationButton latName="latitude" lngName="longitude" />
      </div>
      <p className="hint">Coordinates set the distance shown in marketplace search. Use the button while you are at the business.</p>
      <SubmitButton>Save address</SubmitButton>
    </ActionForm>
  );
}

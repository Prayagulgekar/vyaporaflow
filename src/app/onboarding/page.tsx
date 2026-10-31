import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DemoBanner, Logo } from "@/components/brand";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/ui/client";
import { Notice } from "@/components/ui";
import { logoutAction, onboardingAction } from "@/features/auth/actions";
import { isDemoMode } from "@/lib/env";
import { listStates } from "@/server/companies";
import { homePathFor, requireViewer } from "@/server/viewer";
import { LocationButton } from "@/features/shared/location-button";

export const metadata: Metadata = { title: "Set up your business" };

const CATEGORIES = ["FMCG distribution", "Rice and grains", "Flour and staples", "Packaged snacks", "Biscuits and bakery", "Beverages", "Bottled water", "Household products", "Gas cylinders", "Kirana supplies", "Other"];
const SHOP_TYPES = ["Kirana store", "Supermarket", "Medical store", "Bakery", "Hotel or restaurant", "Pan shop", "Other"];

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const viewer = await requireViewer("/onboarding");
  const home = homePathFor(viewer);
  if (home !== "/onboarding" && viewer.memberships.length > 0) redirect(home);
  const sp = await searchParams;
  const kind = sp.kind === "retailer" || sp.kind === "wholesaler" ? sp.kind : viewer.accountType === "retailer" ? "retailer" : "wholesaler";
  const states = await listStates();

  return (
    <div className="min-h-screen">
      {isDemoMode() ? <DemoBanner /> : null}
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="flex items-center justify-between">
          <Logo href="/" />
          <form action={logoutAction}>
            <button className="btn btn-ghost btn-sm">Sign out</button>
          </form>
        </div>
        <main id="main" className="mt-8">
          {viewer.accountType === "delivery_worker" ? (
            <>
              <h1 className="font-display text-3xl">Waiting for your invitation</h1>
              <p className="mt-2 text-ink-muted">
                Delivery staff join a wholesaler&apos;s team by invitation. Ask the business owner to invite <strong className="text-ink">{viewer.email}</strong> from their Settings → Team page, then open the link they share with you.
              </p>
            </>
          ) : (
            <>
              <h1 className="font-display text-3xl">{kind === "wholesaler" ? "Set up your wholesale business" : "Set up your shop"}</h1>
              <p className="mt-2 text-ink-muted">You can change these details later in your profile.</p>
              <nav className="mt-4 flex gap-2 text-sm" aria-label="Business type">
                <Link href="/onboarding?kind=wholesaler" className={`btn btn-sm ${kind === "wholesaler" ? "btn-primary" : "btn-secondary"}`} aria-current={kind === "wholesaler" ? "page" : undefined}>
                  Wholesaler or distributor
                </Link>
                <Link href="/onboarding?kind=retailer" className={`btn btn-sm ${kind === "retailer" ? "btn-primary" : "btn-secondary"}`} aria-current={kind === "retailer" ? "page" : undefined}>
                  Retail shop
                </Link>
              </nav>
              <ActionForm action={onboardingAction} className="mt-6 space-y-6">
                <input type="hidden" name="kind" value={kind} />
                <fieldset className="card space-y-4 p-5">
                  <legend className="px-1 font-semibold">Business</legend>
                  <TextField name="name" label={kind === "wholesaler" ? "Business name" : "Shop name"} required />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField name="contact_name" label="Owner or contact person" required defaultValue={viewer.fullName} />
                    <TextField name="phone" label="Mobile number" type="tel" inputMode="tel" required defaultValue={viewer.phone ?? ""} hint="10 digits" />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField name="email" label="Business email" type="email" hint="Optional" defaultValue={viewer.email} />
                    <TextField name="gstin" label="GSTIN" hint="Optional. 15 characters, for example 27ABCDE1234F1Z5." className="uppercase" maxLength={15} />
                  </div>
                  {kind === "wholesaler" ? (
                    <SelectField name="business_category" label="What do you mainly sell?" required defaultValue="FMCG distribution">
                      {CATEGORIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </SelectField>
                  ) : (
                    <SelectField name="shop_type" label="Type of shop" defaultValue="Kirana store">
                      {SHOP_TYPES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </SelectField>
                  )}
                  <SelectField name="preferred_language" label="Preferred language" defaultValue={viewer.preferredLanguage} hint="The app is in English today. This records your preference for future translations.">
                    <option value="en">English</option>
                    <option value="hi">हिन्दी (Hindi)</option>
                    <option value="mr">मराठी (Marathi)</option>
                    <option value="gu">ગુજરાતી (Gujarati)</option>
                    <option value="ta">தமிழ் (Tamil)</option>
                    <option value="te">తెలుగు (Telugu)</option>
                    <option value="kn">ಕನ್ನಡ (Kannada)</option>
                    <option value="bn">বাংলা (Bengali)</option>
                  </SelectField>
                </fieldset>
                <fieldset className="card space-y-4 p-5">
                  <legend className="px-1 font-semibold">Address</legend>
                  <TextField name="address.line1" label="Shop or building, street" required autoComplete="address-line1" />
                  <TextField name="address.line2" label="Area or landmark" autoComplete="address-line2" />
                  <div className="grid gap-4 sm:grid-cols-3">
                    <TextField name="address.city" label="City" required autoComplete="address-level2" />
                    <SelectField name="address.state_code" label="State" required defaultValue="27">
                      {states.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.name}
                        </option>
                      ))}
                    </SelectField>
                    <TextField name="address.pincode" label="PIN code" inputMode="numeric" maxLength={6} required autoComplete="postal-code" />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <TextField name="address.latitude" label="Latitude" inputMode="decimal" hint="Optional" />
                    <TextField name="address.longitude" label="Longitude" inputMode="decimal" hint="Optional" />
                    <LocationButton latName="address.latitude" lngName="address.longitude" />
                  </div>
                  <Notice tone="info">
                    {kind === "wholesaler"
                      ? "Your location is used to show retailers how far away you are. Without coordinates, the PIN code's approximate centre is used where it is known."
                      : "Your location is used to find wholesalers near your shop and check delivery coverage."}
                  </Notice>
                </fieldset>
                <SubmitButton pendingLabel="Setting up…">{kind === "wholesaler" ? "Create my business" : "Create my shop"}</SubmitButton>
              </ActionForm>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

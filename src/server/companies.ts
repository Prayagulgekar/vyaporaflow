import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { asService } from "@/server/db";
import { AppError } from "@/server/errors";
import { anonTx, callFn, json, userTx } from "@/server/rpc";
import {
  addressSchema,
  email,
  fieldErrors,
  gstin,
  language,
  optionalEmail,
  optionalPhone,
  optionalText,
  phone,
  uuid,
} from "@/server/validation";

export const onboardingSchema = z.object({
  kind: z.enum(["wholesaler", "retailer"]),
  name: z.string().trim().min(2, "Enter the business name").max(120),
  contact_name: z.string().trim().min(2, "Enter the owner or contact name").max(120),
  phone,
  email: optionalEmail,
  gstin,
  business_category: optionalText(60),
  shop_type: optionalText(60),
  preferred_language: language.default("en"),
  address: addressSchema,
});
export type OnboardingInput = z.input<typeof onboardingSchema>;

function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new AppError("validation", "Please correct the highlighted fields", fieldErrors(r.error));
  return r.data;
}

export async function completeOnboarding(userId: string, input: OnboardingInput): Promise<string> {
  const data = parse(onboardingSchema, input);
  return userTx(userId, (q) => callFn<string>(q, "complete_onboarding", [json(data)]));
}

export async function listStates() {
  return anonTx((q) => q.query<{ code: string; name: string }>("select code, name from public.indian_states order by name"));
}

export interface CompanyProfile {
  id: string;
  kind: "wholesaler" | "retailer";
  name: string;
  slug: string;
  code: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  logo_path: string | null;
  preferred_language: string;
  status: string;
  verification_status: string;
  address: {
    id: string;
    line1: string;
    line2: string | null;
    city: string;
    state_code: string;
    pincode: string;
    latitude: string | null;
    longitude: string | null;
  } | null;
  wholesaler: {
    business_category: string;
    description: string | null;
    offers_delivery: boolean;
    min_order_value: string;
    delivery_charge: string;
    free_delivery_above: string | null;
    auto_approve_retailers: boolean;
    payment_terms_days: number;
    whatsapp_number: string | null;
    opening_hours: Record<string, [string, string]> | null;
    is_listed: boolean;
  } | null;
  retailer: { shop_type: string | null } | null;
}

export async function getCompanyProfile(userId: string, companyId: string): Promise<CompanyProfile> {
  const rows = await userTx(userId, (q) =>
    q.query<CompanyProfile>(
      `select c.id, c.kind, c.name, c.slug, c.code, c.contact_name, c.phone, c.email, c.gstin, c.logo_path,
              c.preferred_language, c.status, c.verification_status,
              (select to_jsonb(a) from public.business_addresses a where a.company_id = c.id and a.is_primary) as address,
              (select to_jsonb(w) - 'company_id' from public.wholesaler_profiles w where w.company_id = c.id) as wholesaler,
              (select jsonb_build_object('shop_type', r.shop_type) from public.retailer_profiles r where r.company_id = c.id) as retailer
         from public.companies c where c.id = $1`,
      [companyId],
    ),
  );
  if (!rows[0]) throw new AppError("not_found", "Business not found");
  return rows[0];
}

const companyUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  contact_name: optionalText(120),
  phone: optionalPhone,
  email: optionalEmail,
  gstin,
  preferred_language: language,
});

export async function updateCompany(userId: string, companyId: string, input: unknown) {
  const d = parse(companyUpdateSchema, input);
  await userTx(userId, async (q) => {
    const r = await q.query(
      `update public.companies set name = $2, contact_name = $3, phone = $4, email = $5, gstin = $6, preferred_language = $7
        where id = $1 returning id`,
      [companyId, d.name, d.contact_name ?? null, d.phone ?? null, d.email ?? null, d.gstin ?? null, d.preferred_language],
    );
    if (!r.length) throw new AppError("forbidden", "Only owners and managers can edit the business profile");
  });
}

export async function updatePrimaryAddress(userId: string, companyId: string, input: unknown) {
  const a = parse(addressSchema, input);
  await userTx(userId, async (q) => {
    const r = await q.query(
      `update public.business_addresses set line1 = $2, line2 = $3, city = $4, state_code = $5, pincode = $6,
              latitude = $7, longitude = $8
        where company_id = $1 and is_primary returning id`,
      [companyId, a.line1, a.line2 ?? null, a.city, a.state_code, a.pincode, a.latitude ?? null, a.longitude ?? null],
    );
    if (!r.length) throw new AppError("forbidden", "Only owners and managers can edit the address");
  });
}

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const time = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Use HH:MM");

const wholesalerSettingsSchema = z.object({
  business_category: z.string().trim().min(2).max(60),
  description: optionalText(1000),
  offers_delivery: z.boolean(),
  min_order_value: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter an amount"),
  delivery_charge: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter an amount"),
  free_delivery_above: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).optional()),
  auto_approve_retailers: z.boolean(),
  payment_terms_days: z.coerce.number().int().min(0).max(180),
  whatsapp_number: optionalPhone,
  is_listed: z.boolean(),
  hours: z.record(z.enum(DAYS), z.object({ open: time, close: time }).nullable()),
});

export async function updateWholesalerSettings(userId: string, companyId: string, input: unknown) {
  const d = parse(wholesalerSettingsSchema, input);
  const hours: Record<string, [string, string]> = {};
  for (const day of DAYS) {
    const h = d.hours[day];
    if (h) {
      if (h.close <= h.open) throw new AppError("validation", `Closing time must be after opening time (${day})`);
      hours[day] = [h.open, h.close];
    }
  }
  await userTx(userId, async (q) => {
    const r = await q.query(
      `update public.wholesaler_profiles set business_category = $2, description = $3, offers_delivery = $4,
              min_order_value = $5, delivery_charge = $6, free_delivery_above = $7, auto_approve_retailers = $8,
              payment_terms_days = $9, whatsapp_number = $10, is_listed = $11, opening_hours = $12
        where company_id = $1 returning company_id`,
      [
        companyId,
        d.business_category,
        d.description ?? null,
        d.offers_delivery,
        d.min_order_value,
        d.delivery_charge,
        d.free_delivery_above ?? null,
        d.auto_approve_retailers,
        d.payment_terms_days,
        d.whatsapp_number ?? null,
        d.is_listed,
        Object.keys(hours).length ? json(hours) : null,
      ],
    );
    if (!r.length) throw new AppError("forbidden", "Only owners and managers can change these settings");
  });
}

export async function setLogo(userId: string, companyId: string, path: string | null) {
  await userTx(userId, async (q) => {
    const r = await q.query("update public.companies set logo_path = $2 where id = $1 returning id", [companyId, path]);
    if (!r.length) throw new AppError("forbidden", "Only owners and managers can change the logo");
  });
}

export async function requestVerification(userId: string, companyId: string) {
  await userTx(userId, (q) => callFn(q, "request_verification", [companyId]));
}

// ---------------------------------------------------------------------------
// Delivery zones
// ---------------------------------------------------------------------------
export interface Zone {
  id: string;
  name: string;
  kind: "radius" | "pincodes";
  radius_km: string | null;
  pincodes: string[];
  is_active: boolean;
}

export async function listZones(userId: string, companyId: string) {
  return userTx(userId, (q) =>
    q.query<Zone>("select id, name, kind, radius_km, pincodes, is_active from public.delivery_zones where company_id = $1 order by created_at", [
      companyId,
    ]),
  );
}

const zoneSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("radius"), name: z.string().trim().min(2).max(80), radius_km: z.coerce.number().positive().max(200) }),
  z.object({
    kind: z.literal("pincodes"),
    name: z.string().trim().min(2).max(80),
    pincodes: z
      .string()
      .transform((s) => [...new Set(s.split(/[\s,]+/).filter(Boolean))])
      .pipe(z.array(z.string().regex(/^[1-9][0-9]{5}$/, "Each PIN code must have 6 digits")).min(1, "Enter at least one PIN code").max(200)),
  }),
]);

export async function addZone(userId: string, companyId: string, input: unknown) {
  const z1 = parse(zoneSchema, input);
  await userTx(userId, (q) =>
    q.query("insert into public.delivery_zones (company_id, name, kind, radius_km, pincodes) values ($1, $2, $3, $4, $5)", [
      companyId,
      z1.name,
      z1.kind,
      z1.kind === "radius" ? z1.radius_km : null,
      z1.kind === "pincodes" ? z1.pincodes : [],
    ]),
  );
}

export async function setZoneActive(userId: string, zoneId: string, active: boolean) {
  await userTx(userId, async (q) => {
    const r = await q.query("update public.delivery_zones set is_active = $2 where id = $1 returning id", [zoneId, active]);
    if (!r.length) throw new AppError("forbidden", "You cannot change this zone");
  });
}

export async function deleteZone(userId: string, zoneId: string) {
  await userTx(userId, async (q) => {
    const r = await q.query("delete from public.delivery_zones where id = $1 returning id", [zoneId]);
    if (!r.length) throw new AppError("forbidden", "You cannot delete this zone");
  });
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------
export interface Member {
  membership_id: string;
  user_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  created_at: Date;
}

export async function listMembers(userId: string, companyId: string) {
  return userTx(userId, (q) =>
    q.query<Member>(
      `select m.id as membership_id, m.user_id, coalesce(nullif(p.full_name, ''), p.email, 'Team member') as full_name,
              p.email, p.phone, m.role, m.status, m.created_at
         from public.company_memberships m left join public.profiles p on p.id = m.user_id
        where m.company_id = $1 order by m.status, m.role, p.full_name`,
      [companyId],
    ),
  );
}

export async function listInvitations(userId: string, companyId: string) {
  return userTx(userId, (q) =>
    q.query<{ id: string; email: string; full_name: string | null; role: string; expires_at: Date; accepted_at: Date | null; revoked_at: Date | null }>(
      `select id, email, full_name, role, expires_at, accepted_at, revoked_at from public.company_invitations
        where company_id = $1 order by created_at desc limit 50`,
      [companyId],
    ),
  );
}

const inviteSchema = z.object({
  email,
  full_name: optionalText(120),
  role: z.enum(["manager", "staff", "delivery_worker"]),
});

/** Returns the one-time invitation token. It is shown once and stored only as a hash. */
export async function createInvitation(userId: string, companyId: string, input: unknown): Promise<string> {
  const d = parse(inviteSchema, input);
  return userTx(userId, (q) => callFn<string>(q, "create_invitation", [companyId, d.email, d.full_name ?? null, d.role]));
}

export async function acceptInvitation(userId: string, token: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new AppError("not_found", "This invitation is not valid");
  return userTx(userId, (q) => callFn<string>(q, "accept_invitation", [token]));
}

/**
 * Minimal invitation details for the public invite page (company name, role,
 * invited email). Trusted lookup by token hash; reveals nothing without the token.
 */
export async function previewInvitation(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = createHash("sha256").update(token).digest("hex");
  const rows = await asService((q) =>
    q.query<{ company_name: string; email: string; role: string; full_name: string | null; usable: boolean }>(
      `select c.name as company_name, i.email, i.role, i.full_name,
              (i.accepted_at is null and i.revoked_at is null and i.expires_at > now()) as usable
         from public.company_invitations i join public.companies c on c.id = i.company_id where i.token_hash = $1`,
      [hash],
    ),
  );
  return rows[0] ?? null;
}

export async function setMemberStatus(userId: string, membershipId: string, status: "active" | "removed") {
  uuid.parse(membershipId);
  await userTx(userId, (q) => callFn(q, "set_member_status", [membershipId, status]));
}

// ---------------------------------------------------------------------------
// Personal profile
// ---------------------------------------------------------------------------
const profileSchema = z.object({ full_name: z.string().trim().min(2).max(120), phone: optionalPhone, preferred_language: language });

export async function updateMyProfile(userId: string, input: unknown) {
  const d = parse(profileSchema, input);
  await userTx(userId, (q) =>
    q.query("update public.profiles set full_name = $2, phone = $3, preferred_language = $4 where id = $1", [
      userId,
      d.full_name,
      d.phone ?? null,
      d.preferred_language,
    ]),
  );
}

export { parse as parseInput };

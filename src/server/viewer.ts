import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { CompanyKind, MembershipRole } from "@/domain/permissions";
import { asUser } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";

export interface Membership {
  membershipId: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  companyKind: CompanyKind;
  companyStatus: "active" | "suspended";
  role: MembershipRole;
  status: "active" | "removed";
}

export interface Viewer {
  userId: string;
  email: string;
  fullName: string;
  phone: string | null;
  accountType: "wholesaler" | "retailer" | "delivery_worker" | null;
  preferredLanguage: string;
  isAdmin: boolean;
  isDemo: boolean;
  memberships: Membership[];
}

export const ACTIVE_COMPANY_COOKIE = "vf_company";

/** Load the signed-in user's profile and memberships (through RLS, as that user). */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  return asUser(user.id, async (q) => {
    const [profile] = await q.query<{
      full_name: string;
      phone: string | null;
      account_type: Viewer["accountType"];
      preferred_language: string;
      is_demo: boolean;
      is_admin: boolean;
    }>(
      `select p.full_name, p.phone, p.account_type, p.preferred_language, p.is_demo, app.is_platform_admin() as is_admin
         from public.profiles p where p.id = auth.uid()`,
    );
    const memberships = await q.query<{
      id: string;
      company_id: string;
      name: string;
      slug: string;
      kind: CompanyKind;
      company_status: "active" | "suspended";
      role: MembershipRole;
      status: "active" | "removed";
    }>(
      `select m.id, m.company_id, c.name, c.slug, c.kind, c.status as company_status, m.role, m.status
         from public.company_memberships m join public.companies c on c.id = m.company_id
        where m.user_id = auth.uid() and m.status = 'active' order by m.created_at`,
    );
    return {
      userId: user.id,
      email: user.email,
      fullName: profile?.full_name ?? "",
      phone: profile?.phone ?? null,
      accountType: profile?.account_type ?? null,
      preferredLanguage: profile?.preferred_language ?? "en",
      isAdmin: profile?.is_admin ?? false,
      isDemo: profile?.is_demo ?? false,
      memberships: memberships.map((m) => ({
        membershipId: m.id,
        companyId: m.company_id,
        companyName: m.name,
        companySlug: m.slug,
        companyKind: m.kind,
        companyStatus: m.company_status,
        role: m.role,
        status: m.status,
      })),
    };
  });
});

export async function requireViewer(next?: string): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return v;
}

/** Where a signed-in user should land. */
export function homePathFor(v: Viewer): string {
  if (v.memberships.some((m) => m.role === "delivery_worker") && v.accountType === "delivery_worker") return "/d";
  const kinds = new Set(v.memberships.filter((m) => m.role !== "delivery_worker").map((m) => m.companyKind));
  if (v.accountType === "wholesaler" && kinds.has("wholesaler")) return "/w";
  if (v.accountType === "retailer" && kinds.has("retailer")) return "/r";
  if (kinds.has("wholesaler")) return "/w";
  if (kinds.has("retailer")) return "/r";
  if (v.memberships.some((m) => m.role === "delivery_worker")) return "/d";
  if (v.isAdmin) return "/admin";
  return "/onboarding";
}

async function pickCompany(v: Viewer, kind: CompanyKind, roles: MembershipRole[]): Promise<Membership | null> {
  const candidates = v.memberships.filter((m) => m.companyKind === kind && roles.includes(m.role));
  if (candidates.length === 0) return null;
  const preferred = (await cookies()).get(ACTIVE_COMPANY_COOKIE)?.value;
  return candidates.find((m) => m.companyId === preferred) ?? candidates[0]!;
}

export interface CompanyContext {
  viewer: Viewer;
  company: Membership;
}

/** Page-level gate for the wholesaler workspace (office staff). The database re-checks every operation. */
export async function requireWholesaler(): Promise<CompanyContext> {
  const viewer = await requireViewer("/w");
  const company = await pickCompany(viewer, "wholesaler", ["owner", "manager", "staff"]);
  if (!company) redirect(homePathFor(viewer) === "/w" ? "/onboarding" : homePathFor(viewer));
  return { viewer, company };
}

export async function requireRetailer(): Promise<CompanyContext> {
  const viewer = await requireViewer("/r");
  const company = await pickCompany(viewer, "retailer", ["owner", "manager", "staff"]);
  if (!company) redirect(homePathFor(viewer) === "/r" ? "/onboarding" : homePathFor(viewer));
  return { viewer, company };
}

export async function requireDeliveryWorker(): Promise<Viewer> {
  const viewer = await requireViewer("/d");
  if (!viewer.memberships.some((m) => m.companyKind === "wholesaler")) redirect(homePathFor(viewer));
  return viewer;
}

export async function requireAdmin(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/admin/login");
  if (!viewer.isAdmin) redirect(homePathFor(viewer));
  return viewer;
}

/** Whether this user is a platform administrator, checked in the database as that user. */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  return asUser(userId, async (q) => {
    const [row] = await q.query<{ is_admin: boolean }>("select app.is_platform_admin() as is_admin");
    return Boolean(row?.is_admin);
  });
}

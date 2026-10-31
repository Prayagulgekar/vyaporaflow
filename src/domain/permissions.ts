/**
 * Company-scoped capabilities. The database functions and RLS policies are the
 * enforcement point; this module mirrors them so the server can fail fast with
 * a clear message and the UI can show only relevant actions.
 */
export type MembershipRole = "owner" | "manager" | "staff" | "delivery_worker";
export type CompanyKind = "wholesaler" | "retailer";

export type Capability =
  | "catalog.manage"
  | "inventory.adjust"
  | "orders.process"
  | "orders.place"
  | "billing.invoice"
  | "billing.void"
  | "payments.record"
  | "payments.reverse"
  | "delivery.assign"
  | "delivery.perform"
  | "team.manage"
  | "relationships.decide"
  | "settings.manage"
  | "reports.view";

const OFFICE: MembershipRole[] = ["owner", "manager", "staff"];
const MANAGERS: MembershipRole[] = ["owner", "manager"];

const RULES: Record<Capability, { kinds: CompanyKind[]; roles: MembershipRole[] }> = {
  "catalog.manage": { kinds: ["wholesaler"], roles: MANAGERS },
  "inventory.adjust": { kinds: ["wholesaler"], roles: OFFICE },
  "orders.process": { kinds: ["wholesaler"], roles: OFFICE },
  "orders.place": { kinds: ["retailer"], roles: OFFICE },
  "billing.invoice": { kinds: ["wholesaler"], roles: OFFICE },
  "billing.void": { kinds: ["wholesaler"], roles: MANAGERS },
  "payments.record": { kinds: ["wholesaler"], roles: OFFICE },
  "payments.reverse": { kinds: ["wholesaler"], roles: MANAGERS },
  "delivery.assign": { kinds: ["wholesaler"], roles: OFFICE },
  "delivery.perform": { kinds: ["wholesaler"], roles: ["owner", "manager", "staff", "delivery_worker"] },
  "team.manage": { kinds: ["wholesaler", "retailer"], roles: MANAGERS },
  "relationships.decide": { kinds: ["wholesaler"], roles: MANAGERS },
  "settings.manage": { kinds: ["wholesaler", "retailer"], roles: MANAGERS },
  "reports.view": { kinds: ["wholesaler"], roles: OFFICE },
};

export interface MembershipLike {
  companyId: string;
  companyKind: CompanyKind;
  role: MembershipRole;
  status?: "active" | "removed";
  companyStatus?: "active" | "suspended";
}

export function can(memberships: MembershipLike[], companyId: string, capability: Capability): boolean {
  const m = memberships.find((x) => x.companyId === companyId && (x.status ?? "active") === "active");
  if (!m) return false;
  const rule = RULES[capability];
  return rule.kinds.includes(m.companyKind) && rule.roles.includes(m.role);
}

/** Write actions are additionally blocked for suspended companies. */
export function canWrite(memberships: MembershipLike[], companyId: string, capability: Capability): boolean {
  const m = memberships.find((x) => x.companyId === companyId);
  return can(memberships, companyId, capability) && (m?.companyStatus ?? "active") === "active";
}

/** Public registration may only create these account types. Administrators are provisioned separately. */
export const SELF_SERVICE_ACCOUNT_TYPES = ["wholesaler", "retailer", "delivery_worker"] as const;
export type SelfServiceAccountType = (typeof SELF_SERVICE_ACCOUNT_TYPES)[number];

export function isSelfServiceAccountType(value: unknown): value is SelfServiceAccountType {
  return typeof value === "string" && (SELF_SERVICE_ACCOUNT_TYPES as readonly string[]).includes(value);
}

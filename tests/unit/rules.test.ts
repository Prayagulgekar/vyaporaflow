import { describe, expect, it } from "vitest";
import { canTransition, canTransitionDelivery, nextStatuses, ORDER_STATUSES } from "@/domain/order-status";
import { can, canWrite, isSelfServiceAccountType } from "@/domain/permissions";
import { distanceKm, DEFAULT_RADIUS_KM, isValidCoordinate, isValidPincode, SEARCH_RADII_KM } from "@/domain/geo";
import { ConfigError, parseEnv } from "@/lib/env";
import { isNavigationError } from "@/lib/action-state";
import { csvEscape, parseCsv } from "@/server/catalog";
import { addressSchema, gstin, password, phone } from "@/server/validation";
import { whatsappLink } from "@/lib/format";

describe("order lifecycle", () => {
  it("allows only the defined transitions", () => {
    expect(canTransition("placed", "accepted")).toBe(true);
    expect(canTransition("placed", "delivered")).toBe(false);
    expect(canTransition("delivered", "cancelled")).toBe(false);
    expect(canTransition("out_for_delivery", "cancelled")).toBe(false);
    expect(nextStatuses("cancelled")).toEqual([]);
    for (const s of ORDER_STATUSES) expect(canTransition(s, s)).toBe(false);
  });

  it("allows delivery outcomes only from out for delivery", () => {
    expect(canTransitionDelivery("assigned", "out_for_delivery")).toBe(true);
    expect(canTransitionDelivery("assigned", "delivered")).toBe(false);
    expect(canTransitionDelivery("out_for_delivery", "partially_delivered")).toBe(true);
    expect(canTransitionDelivery("delivered", "failed")).toBe(false);
  });
});

describe("permissions", () => {
  const ms = [
    { companyId: "w1", companyKind: "wholesaler" as const, role: "staff" as const },
    { companyId: "w2", companyKind: "wholesaler" as const, role: "owner" as const, companyStatus: "suspended" as const },
    { companyId: "r1", companyKind: "retailer" as const, role: "owner" as const },
    { companyId: "w3", companyKind: "wholesaler" as const, role: "delivery_worker" as const },
  ];

  it("is company-scoped and role-based", () => {
    expect(can(ms, "w1", "orders.process")).toBe(true);
    expect(can(ms, "w1", "catalog.manage")).toBe(false);
    expect(can(ms, "w1", "payments.reverse")).toBe(false);
    expect(can(ms, "r1", "orders.place")).toBe(true);
    expect(can(ms, "r1", "orders.process")).toBe(false);
    expect(can(ms, "w3", "orders.process")).toBe(false);
    expect(can(ms, "w3", "delivery.perform")).toBe(true);
    expect(can(ms, "unknown", "orders.process")).toBe(false);
  });

  it("blocks writes for suspended companies", () => {
    expect(can(ms, "w2", "catalog.manage")).toBe(true);
    expect(canWrite(ms, "w2", "catalog.manage")).toBe(false);
  });

  it("never allows admin as a self-service account type", () => {
    expect(isSelfServiceAccountType("retailer")).toBe(true);
    expect(isSelfServiceAccountType("admin")).toBe(false);
    expect(isSelfServiceAccountType("platform_admin")).toBe(false);
  });
});

describe("geography", () => {
  it("uses the required radius options", () => {
    expect(DEFAULT_RADIUS_KM).toBe(50);
    expect([...SEARCH_RADII_KM]).toEqual([10, 25, 50, 60]);
  });

  it("computes haversine distance", () => {
    expect(distanceKm(18.5204, 73.8567, 19.076, 72.8777)).toBeCloseTo(120.15, 0);
    expect(distanceKm(18.5204, 73.8567, 18.5204, 73.8567)).toBe(0);
  });

  it("validates PIN codes and coordinates", () => {
    expect(isValidPincode("411038")).toBe(true);
    expect(isValidPincode("011038")).toBe(false);
    expect(isValidPincode("41103")).toBe(false);
    expect(isValidCoordinate(18.5, 73.8)).toBe(true);
    expect(isValidCoordinate(91, 0)).toBe(false);
  });
});

describe("configuration", () => {
  it("defaults to demo mode", () => {
    expect(parseEnv({}).APP_MODE).toBe("demo");
  });

  it("fails clearly when production settings are missing", () => {
    expect(() => parseEnv({ APP_MODE: "production" })).toThrow(ConfigError);
    try {
      parseEnv({ APP_MODE: "production", NEXT_PUBLIC_APP_URL: "https://app.example.com" });
    } catch (e) {
      expect((e as Error).message).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
      expect((e as Error).message).toMatch(/DATABASE_URL/);
    }
  });

  it("accepts a complete production configuration", () => {
    const env = parseEnv({
      APP_MODE: "production",
      NEXT_PUBLIC_APP_URL: "https://app.example.com",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key-placeholder-value",
      DATABASE_URL: "postgresql://user:pass@host:6543/postgres",
    });
    expect(env.APP_MODE).toBe("production");
  });

  it("rejects unknown modes", () => {
    expect(() => parseEnv({ APP_MODE: "staging" })).toThrow(/APP_MODE/);
  });
});

describe("input validation", () => {
  it("validates Indian phone numbers, GSTIN and passwords", () => {
    expect(phone.safeParse("9876543210").success).toBe(true);
    expect(phone.safeParse("12345").success).toBe(false);
    expect(gstin.safeParse("").success).toBe(true);
    expect(gstin.safeParse("27abcde1234f1z5").success).toBe(true);
    expect(gstin.safeParse("NOTAGSTIN").success).toBe(false);
    expect(password.safeParse("short1").success).toBe(false);
    expect(password.safeParse("onlyletterslong").success).toBe(false);
    expect(password.safeParse("longenough123").success).toBe(true);
  });

  it("validates addresses", () => {
    expect(addressSchema.safeParse({ line1: "Shop 4, MG Road", city: "Pune", state_code: "27", pincode: "411001" }).success).toBe(true);
    expect(addressSchema.safeParse({ line1: "Shop 4", city: "Pune", state_code: "27", pincode: "4110" }).success).toBe(false);
  });
});

describe("CSV", () => {
  it("escapes quotes, commas and spreadsheet formulas", () => {
    expect(csvEscape('Say "hi", ok')).toBe('"Say ""hi"", ok"');
    expect(csvEscape("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvEscape("-5")).toBe("'-5");
    expect(csvEscape(null)).toBe("");
  });

  it("parses quoted fields and line endings", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n\n1,2')).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["1", "2"]]);
  });
});

describe("misc", () => {
  it("detects Next.js navigation errors", () => {
    expect(isNavigationError({ digest: "NEXT_REDIRECT;replace;/x;307;" })).toBe(true);
    expect(isNavigationError(new Error("x"))).toBe(false);
  });

  it("builds WhatsApp links with Indian country code", () => {
    expect(whatsappLink("98765 43210", "Hi")).toBe("https://wa.me/919876543210?text=Hi");
    expect(whatsappLink(null, "Hi")).toBeNull();
  });
});

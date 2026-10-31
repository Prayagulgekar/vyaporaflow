import { describe, expect, it } from "vitest";
import { checkCollection, planHandover } from "@/domain/cash";

describe("checkCollection", () => {
  it("allows partial, full and zero collections and gives the exact remainder", () => {
    expect(checkCollection("200.00", "100")).toEqual({ ok: true, remaining: "100.00" });
    expect(checkCollection("300.00", "200")).toEqual({ ok: true, remaining: "100.00" });
    expect(checkCollection("200.00", "200.00")).toEqual({ ok: true, remaining: "0.00" });
    expect(checkCollection("200.00", "0")).toEqual({ ok: true, remaining: "200.00" });
    expect(checkCollection("0.30", "0.1")).toEqual({ ok: true, remaining: "0.20" });
  });
  it("refuses more than is due, negative amounts and bad input", () => {
    expect(checkCollection("200.00", "200.01").ok).toBe(false);
    expect(checkCollection("-300.00", "1").ok).toBe(false);
    expect(checkCollection("200", "-1").ok).toBe(false);
    expect(checkCollection("200", "1.005").ok).toBe(false);
    expect(checkCollection("200", "abc").ok).toBe(false);
  });
});

describe("planHandover", () => {
  const items = [
    { id: "b", collectedAt: "2026-10-29T10:00:00Z", pending: "200.00" },
    { id: "a", collectedAt: "2026-10-29T09:00:00Z", pending: "100.00" },
  ];
  it("covers everything when the full amount arrives", () => {
    expect(planHandover(items, "300")).toEqual({
      expected: "300.00", received: "300.00", discrepancy: "0.00",
      items: [{ id: "a", amount: "100.00", stillPending: "0.00" }, { id: "b", amount: "200.00", stillPending: "0.00" }],
    });
  });
  it("applies a short amount oldest first and leaves the rest pending", () => {
    const p = planHandover(items, "250");
    expect(p.discrepancy).toBe("50.00");
    expect(p.items).toEqual([{ id: "a", amount: "100.00", stillPending: "0.00" }, { id: "b", amount: "150.00", stillPending: "50.00" }]);
  });
  it("refuses zero or more than expected", () => {
    expect(() => planHandover(items, "0")).toThrow();
    expect(() => planHandover(items, "300.01")).toThrow();
  });
});

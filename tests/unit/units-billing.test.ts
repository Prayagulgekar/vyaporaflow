import { describe, expect, it } from "vitest";
import { agingBuckets, invoiceDue, invoicePaymentStatus, outstandingBalance, planFifoAllocation, validateAllocation } from "@/domain/billing";
import { convertStandard, formatQuantity, toBaseQuantity, UnitConversionError, validateQuantity } from "@/domain/units";

const kg = { code: "kg", dimension: "mass" as const, baseFactor: 1000, allowsFraction: true };
const g = { code: "g", dimension: "mass" as const, baseFactor: 1, allowsFraction: true };
const quintal = { code: "quintal", dimension: "mass" as const, baseFactor: 100000, allowsFraction: true };
const litre = { code: "litre", dimension: "volume" as const, baseFactor: 1000, allowsFraction: true };
const packet = { code: "packet", dimension: "count" as const, baseFactor: null, allowsFraction: false };

describe("units", () => {
  it("converts standard mass and volume units", () => {
    expect(convertStandard("2.5", kg, g)).toBe("2500.000");
    expect(convertStandard("1", quintal, kg)).toBe("100.000");
    expect(convertStandard("750", g, kg)).toBe("0.750");
  });

  it("refuses conversions without a rule", () => {
    expect(() => convertStandard("1", packet, kg)).toThrow(UnitConversionError);
    expect(() => convertStandard("1", kg, litre)).toThrow(UnitConversionError);
  });

  it("converts selling units to stock units with the variant pack size", () => {
    expect(toBaseQuantity("2", "48")).toBe("96.000");
    expect(toBaseQuantity("1.5", "25")).toBe("37.500");
    expect(() => toBaseQuantity("1", "0")).toThrow(UnitConversionError);
  });

  it("validates minimum, step and whole-unit rules", () => {
    const rule = { minOrderQty: "12", qtyStep: "6", allowsFraction: false, unitLabel: "packets" };
    expect(validateQuantity("18", rule)).toEqual([]);
    expect(validateQuantity("6", rule)).toEqual(["Minimum order is 12"]);
    expect(validateQuantity("13", rule)).toEqual(["Order in multiples of 6"]);
    expect(validateQuantity("12.5", rule)).toContain("Order whole packets");
    expect(validateQuantity("0", rule)).toEqual(["Quantity must be greater than zero"]);
    expect(validateQuantity("abc", rule)).toEqual(["Enter a number"]);
    expect(validateQuantity("10.5", { minOrderQty: "10", qtyStep: "0.5", allowsFraction: true, unitLabel: "kg" })).toEqual([]);
  });

  it("formats quantities without trailing zeros", () => {
    expect(formatQuantity("24.000", "packet")).toBe("24 packet");
    expect(formatQuantity("2.500")).toBe("2.5");
  });
});

describe("receivables", () => {
  const invoices = [
    { id: "b", dueDate: "2026-10-20", invoiceDate: "2026-10-05", number: "INV/2", due: "500.00" },
    { id: "a", dueDate: "2026-10-10", invoiceDate: "2026-09-25", number: "INV/1", due: "300.00" },
    { id: "c", dueDate: "2026-11-01", invoiceDate: "2026-10-15", number: "INV/3", due: "0.00" },
  ];

  it("allocates oldest due first and leaves the rest unapplied", () => {
    expect(planFifoAllocation("650", invoices)).toEqual([
      { invoiceId: "a", amount: "300.00" },
      { invoiceId: "b", amount: "350.00" },
    ]);
    expect(planFifoAllocation("1000", invoices)).toEqual([
      { invoiceId: "a", amount: "300.00" },
      { invoiceId: "b", amount: "500.00" },
    ]);
    expect(() => planFifoAllocation("0", invoices)).toThrow();
  });

  it("computes due amounts, status and outstanding balance", () => {
    expect(invoiceDue("1000.00", "100.00", "250.50")).toBe("649.50");
    expect(invoicePaymentStatus({ void: false, due: "0", paidOrCredited: "10", dueDate: "2026-01-01", today: "2026-10-28" })).toBe("paid");
    expect(invoicePaymentStatus({ void: false, due: "5", paidOrCredited: "10", dueDate: "2026-10-27", today: "2026-10-28" })).toBe("overdue");
    expect(invoicePaymentStatus({ void: false, due: "5", paidOrCredited: "10", dueDate: "2026-10-28", today: "2026-10-28" })).toBe("partially_paid");
    expect(invoicePaymentStatus({ void: false, due: "5", paidOrCredited: "0", dueDate: "2026-10-30", today: "2026-10-28" })).toBe("unpaid");
    expect(invoicePaymentStatus({ void: true, due: "5", paidOrCredited: "0", dueDate: "2026-10-30", today: "2026-10-28" })).toBe("void");
    expect(outstandingBalance("5000", "200", "6000")).toBe("-1200.00");
  });

  it("validates manual allocations", () => {
    expect(validateAllocation({ amount: "100", unapplied: "50", invoiceDue: "500" })).toMatch(/unapplied/);
    expect(validateAllocation({ amount: "100", unapplied: "500", invoiceDue: "50" })).toMatch(/due/);
    expect(validateAllocation({ amount: "0", unapplied: "500", invoiceDue: "50" })).toMatch(/positive/);
    expect(validateAllocation({ amount: "50", unapplied: "500", invoiceDue: "50" })).toBeNull();
  });

  it("buckets receivables by age", () => {
    expect(
      agingBuckets([
        { due: "100", daysOverdue: 0 },
        { due: "200", daysOverdue: 15 },
        { due: "300", daysOverdue: 45 },
        { due: "400", daysOverdue: 75 },
        { due: "500", daysOverdue: 120 },
        { due: "0", daysOverdue: 200 },
      ]),
    ).toEqual({ current: "100.00", d1_30: "200.00", d31_60: "300.00", d61_90: "400.00", d90_plus: "500.00" });
  });
});

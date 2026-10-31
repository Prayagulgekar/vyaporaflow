import { describe, expect, it } from "vitest";
import { calcLine, deliveryChargeFor, orderTotals } from "@/domain/pricing";
import { financialYearLabel, gstinStateCode, isGstinFormat, splitGst, supplyType } from "@/domain/tax";

describe("line pricing", () => {
  it("adds GST on top of exclusive prices", () => {
    const l = calcLine({ quantity: "2", unitPrice: "816.00", discountPercent: "2", taxRate: "5", priceIncludesTax: false });
    expect(l).toEqual({ lineAmount: "1632.00", discountAmount: "32.64", taxableAmount: "1599.36", taxAmount: "79.97", lineTotal: "1679.33" });
  });

  it("extracts GST from inclusive prices without changing the total", () => {
    const l = calcLine({ quantity: "5", unitPrice: "180.00", discountPercent: "0", taxRate: "18", priceIncludesTax: true });
    expect(l.lineTotal).toBe("900.00");
    expect(l.taxableAmount).toBe("762.71");
    expect(l.taxAmount).toBe("137.29");
  });

  it("handles zero-rated goods and fractional quantities", () => {
    const l = calcLine({ quantity: "12.5", unitPrice: "46.00", discountPercent: "0", taxRate: "0", priceIncludesTax: false });
    expect(l.lineTotal).toBe("575.00");
    expect(l.taxAmount).toBe("0.00");
  });

  it("applies delivery charge rules", () => {
    const p = { offersDelivery: true, deliveryCharge: "50", freeDeliveryAbove: "2000" };
    expect(deliveryChargeFor("1999.99", p)).toBe("50.00");
    expect(deliveryChargeFor("2000.00", p)).toBe("0.00");
    expect(deliveryChargeFor("100", { ...p, offersDelivery: false })).toBe("0.00");
    expect(deliveryChargeFor("100", { ...p, freeDeliveryAbove: null })).toBe("50.00");
  });

  it("totals an order from its lines", () => {
    const a = calcLine({ quantity: "24", unitPrice: "8.70", discountPercent: "0", taxRate: "5", priceIncludesTax: false });
    const b = calcLine({ quantity: "1", unitPrice: "204.00", discountPercent: "0", taxRate: "5", priceIncludesTax: false });
    const t = orderTotals([a, b], { offersDelivery: true, deliveryCharge: "40", freeDeliveryAbove: null });
    expect(t.taxableTotal).toBe("412.80");
    expect(t.taxTotal).toBe("20.64");
    expect(t.itemsTotal).toBe("433.44");
    expect(t.grandTotal).toBe("473.44");
  });
});

describe("GST", () => {
  it("chooses intra or inter state supply", () => {
    expect(supplyType("27", "27")).toBe("intra_state");
    expect(supplyType("27", "29")).toBe("inter_state");
  });

  it("splits CGST and SGST like the database (CGST rounded half up, SGST takes the rest)", () => {
    expect(splitGst("79.97", "intra_state")).toEqual({ cgst: "39.99", sgst: "39.98", igst: "0.00" });
    expect(splitGst("79.97", "inter_state")).toEqual({ cgst: "0.00", sgst: "0.00", igst: "79.97" });
  });

  it("validates GSTIN format and state code", () => {
    expect(isGstinFormat("27ABCDE1234F1Z5")).toBe(true);
    expect(isGstinFormat("27abcde1234f1z5")).toBe(true); // input is normalised to upper case
    expect(isGstinFormat("27ABCDE1234")).toBe(false);
    expect(isGstinFormat("27ABCDE1234F1Y5")).toBe(false);
    expect(gstinStateCode("29ABCDE1234F1Z5")).toBe("29");
  });

  it("labels Indian financial years (April to March)", () => {
    expect(financialYearLabel(new Date("2026-03-31T12:00:00+05:30"))).toBe("25-26");
    expect(financialYearLabel(new Date("2026-04-01T00:30:00+05:30"))).toBe("26-27");
  });
});

import { describe, expect, it } from "vitest";
import { addMoney, compareMoney, divRound, formatINR, fromScaled, isValidMoneyInput, multiplyQtyPrice, paise, percentOf, rupees, subMoney, toScaled } from "@/domain/money";

describe("money (scaled BigInt, no floating point)", () => {
  it("parses decimals exactly", () => {
    expect(toScaled("0.1", 2)).toBe(10n);
    expect(toScaled("1234.5", 2)).toBe(123450n);
    expect(toScaled("-3.25", 2)).toBe(-325n);
    expect(toScaled(7, 2)).toBe(700n);
  });

  it("rounds half away from zero like PostgreSQL round(numeric)", () => {
    expect(toScaled("2.345", 2)).toBe(235n);
    expect(toScaled("2.344", 2)).toBe(234n);
    expect(toScaled("-2.345", 2)).toBe(-235n);
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
  });

  it("avoids binary floating point errors", () => {
    expect(addMoney("0.1", "0.2")).toBe("0.30");
    expect(addMoney("19.99", "0.01", "80")).toBe("100.00");
    expect(subMoney("100", "33.33")).toBe("66.67");
  });

  it("multiplies quantity by price and rounds to paise", () => {
    expect(multiplyQtyPrice("3", "17.50")).toBe("52.50");
    expect(multiplyQtyPrice("2.5", "46.00")).toBe("115.00");
    expect(multiplyQtyPrice("0.333", "10.00")).toBe("3.33");
    expect(multiplyQtyPrice("48", "816.00")).toBe("39168.00");
  });

  it("computes percentages", () => {
    expect(percentOf("816.00", "2")).toBe("16.32");
    expect(percentOf("100.00", "12.5")).toBe("12.50");
    expect(percentOf("0.05", "50")).toBe("0.03");
  });

  it("compares and converts", () => {
    expect(compareMoney("10.00", "9.99")).toBe(1);
    expect(compareMoney("10", "10.00")).toBe(0);
    expect(paise("12.34")).toBe(1234n);
    expect(rupees(-5n)).toBe("-0.05");
    expect(fromScaled(123456n, 3)).toBe("123.456");
  });

  it("formats Indian rupees with lakh grouping", () => {
    expect(formatINR("1234567.5")).toBe("₹12,34,567.50");
    expect(formatINR("0")).toBe("₹0.00");
    expect(formatINR("-1500")).toBe("-₹1,500.00");
    expect(formatINR(null)).toBe("—");
  });

  it("validates money input text", () => {
    expect(isValidMoneyInput("100")).toBe(true);
    expect(isValidMoneyInput("100.5")).toBe(true);
    expect(isValidMoneyInput("100.555")).toBe(false);
    expect(isValidMoneyInput("1e5")).toBe(false);
    expect(isValidMoneyInput("-5")).toBe(false);
  });

  it("rejects invalid numbers", () => {
    expect(() => toScaled("abc", 2)).toThrow();
    expect(() => toScaled(Number.NaN, 2)).toThrow();
  });
});

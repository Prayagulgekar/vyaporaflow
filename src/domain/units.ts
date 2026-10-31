import { divRound, fromScaled, toScaled, type Decimalish } from "./money";

/**
 * Unit conversion rules.
 *  - Mass and volume units convert universally through a base factor
 *    (grams, millilitres): 1 kg = 1000 g, 1 quintal = 100 kg.
 *  - Count units (packet, box, carton...) have no universal size. A product
 *    variant declares how many stock units one selling unit contains, e.g.
 *    1 carton = 48 packets. Without that rule there is no conversion.
 */
export interface UnitDef {
  code: string;
  dimension: "count" | "mass" | "volume";
  baseFactor: Decimalish | null;
  allowsFraction: boolean;
}

export class UnitConversionError extends Error {}

export function convertStandard(quantity: Decimalish, from: UnitDef, to: UnitDef): string {
  if (from.code === to.code) return fromScaled(toScaled(quantity, 3), 3);
  if (from.dimension === "count" || to.dimension === "count") {
    throw new UnitConversionError(`No standard conversion between ${from.code} and ${to.code}; configure a pack size`);
  }
  if (from.dimension !== to.dimension) {
    throw new UnitConversionError(`Cannot convert ${from.dimension} (${from.code}) to ${to.dimension} (${to.code})`);
  }
  const q = toScaled(quantity, 3);
  const f = toScaled(from.baseFactor ?? 0, 6);
  const t = toScaled(to.baseFactor ?? 0, 6);
  return fromScaled(divRound(q * f, t), 3);
}

/** Selling-unit quantity -> stock (base) units using the variant's configured factor. */
export function toBaseQuantity(quantity: Decimalish, factorToBase: Decimalish): string {
  const q = toScaled(quantity, 3);
  const f = toScaled(factorToBase, 3);
  if (f <= 0n) throw new UnitConversionError("Pack size must be greater than zero");
  return fromScaled(divRound(q * f, 1000n), 3);
}

export interface QuantityRule {
  minOrderQty: Decimalish;
  qtyStep: Decimalish;
  allowsFraction: boolean;
  unitLabel: string;
}

/** Validate an ordered quantity. Mirrors the checks in app._quote(). */
export function validateQuantity(quantity: Decimalish, rule: QuantityRule): string[] {
  const issues: string[] = [];
  let q: bigint;
  try {
    q = toScaled(quantity, 3);
  } catch {
    return ["Enter a number"];
  }
  if (q <= 0n) return ["Quantity must be greater than zero"];
  if (!rule.allowsFraction && q % 1000n !== 0n) issues.push(`Order whole ${rule.unitLabel}`);
  const min = toScaled(rule.minOrderQty, 3);
  if (q < min) issues.push(`Minimum order is ${trimZeros(fromScaled(min, 3))}`);
  const step = toScaled(rule.qtyStep, 3);
  if (step > 0n && q % step !== 0n) issues.push(`Order in multiples of ${trimZeros(fromScaled(step, 3))}`);
  return issues;
}

export function trimZeros(text: string): string {
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

export function formatQuantity(value: Decimalish, unit?: string): string {
  const t = trimZeros(fromScaled(toScaled(value, 3), 3));
  return unit ? `${t} ${unit}` : t;
}

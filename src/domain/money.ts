/**
 * Exact decimal money and quantity arithmetic using scaled BigInt.
 * Money is held in paise (2 decimal places). Rounding is half away from zero,
 * matching PostgreSQL round(numeric, 2). The database is authoritative for
 * stored amounts; this module mirrors it for previews, validation and tests.
 * Binary floating point is never used for money.
 */
export type Decimalish = string | number | bigint;

const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

/** Parse a decimal string to a scaled BigInt with `scale` fractional digits (exact, rounds half away from zero). */
export function toScaled(value: Decimalish, scale: number): bigint {
  if (typeof value === "bigint") return value * 10n ** BigInt(scale);
  const text = typeof value === "number" ? numberToPlainString(value) : value.trim();
  const m = DECIMAL_RE.exec(text);
  if (!m) throw new RangeError(`Not a decimal number: "${text}"`);
  const neg = m[1] === "-";
  const int = m[2] ?? "0";
  const frac = m[3] ?? "";
  const kept = (frac + "0".repeat(scale)).slice(0, scale);
  let result = BigInt(int + kept);
  const next = frac.charCodeAt(scale) - 48;
  if (frac.length > scale && next >= 5) result += 1n;
  return neg ? -result : result;
}

function numberToPlainString(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError("Amount must be finite");
  // toFixed(12) avoids exponent notation; trailing digits are trimmed by parsing.
  return n.toFixed(12).replace(/\.?0+$/, "") || "0";
}

export function fromScaled(value: bigint, scale: number): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const s = abs.toString().padStart(scale + 1, "0");
  const int = s.slice(0, s.length - scale);
  const frac = scale > 0 ? "." + s.slice(s.length - scale) : "";
  return (neg && abs !== 0n ? "-" : "") + int + frac;
}

/** Divide scaled integers, rounding half away from zero. */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("Division by zero");
  const neg = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return neg ? -rounded : rounded;
}

/** Money as integer paise. */
export const paise = (v: Decimalish) => toScaled(v, 2);
export const rupees = (p: bigint) => fromScaled(p, 2);

export function addMoney(...values: Decimalish[]): string {
  return rupees(values.reduce<bigint>((sum, v) => sum + paise(v), 0n));
}

export function subMoney(a: Decimalish, b: Decimalish): string {
  return rupees(paise(a) - paise(b));
}

export function compareMoney(a: Decimalish, b: Decimalish): -1 | 0 | 1 {
  const d = paise(a) - paise(b);
  return d === 0n ? 0 : d < 0n ? -1 : 1;
}

/** quantity (3 dp) x unit price (2 dp) -> money, rounded to paise. */
export function multiplyQtyPrice(quantity: Decimalish, unitPrice: Decimalish): string {
  const q = toScaled(quantity, 3);
  const p = paise(unitPrice);
  return rupees(divRound(q * p, 1000n));
}

/** amount x percent / 100, rounded to paise. Percent has up to 2 dp. */
export function percentOf(amount: Decimalish, percent: Decimalish): string {
  const a = paise(amount);
  const pct = toScaled(percent, 2); // basis points x100
  return rupees(divRound(a * pct, 10000n));
}

const inrFormatter = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });

/** Display only. Formats a decimal string as ₹1,23,456.78 without float rounding drift. */
export function formatINR(value: Decimalish | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const text = rupees(paise(value));
  const neg = text.startsWith("-");
  const [int = "0", frac = "00"] = (neg ? text.slice(1) : text).split(".");
  const grouped = inrFormatter
    .format(Number(int))
    .replace(/\.\d+$/, "")
    .replace(/^-/, "");
  return `${neg ? "-" : ""}${grouped}.${frac}`;
}

export function isValidMoneyInput(text: string): boolean {
  return /^\d{1,10}(\.\d{1,2})?$/.test(text.trim());
}

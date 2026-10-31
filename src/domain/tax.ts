import { divRound, paise, rupees, type Decimalish } from "./money";

/**
 * GST split for an invoice line. Intra-state supply (seller state = place of
 * supply) splits tax into CGST and SGST halves; the SGST half absorbs the odd
 * paisa. Inter-state supply is IGST. This is a simplified model: special
 * cases (exports, SEZ, reverse charge, composition dealers, cess, e-invoicing)
 * are NOT handled and must be reviewed by a tax professional.
 */
export type SupplyType = "intra_state" | "inter_state";

export function supplyType(sellerStateCode: string, placeOfSupply: string): SupplyType {
  return sellerStateCode === placeOfSupply ? "intra_state" : "inter_state";
}

export function splitGst(taxAmount: Decimalish, type: SupplyType): { cgst: string; sgst: string; igst: string } {
  const tax = paise(taxAmount);
  if (type === "inter_state") return { cgst: "0.00", sgst: "0.00", igst: rupees(tax) };
  const cgst = divRound(tax, 2n);
  return { cgst: rupees(cgst), sgst: rupees(tax - cgst), igst: "0.00" };
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Format check only (same pattern as the database constraint). Does not verify registration. */
export function isGstinFormat(gstin: string): boolean {
  return GSTIN_RE.test(gstin.trim().toUpperCase());
}

export function gstinStateCode(gstin: string): string | null {
  return isGstinFormat(gstin) ? gstin.slice(0, 2) : null;
}

/** Indian financial year label for a date, e.g. 2026-10-28 -> "26-27". Mirrors app.fy_label(). */
export function financialYearLabel(date: Date): string {
  // Compute in IST (UTC+05:30, no daylight saving) so a 00:30 IST invoice on 1 April lands in the new year.
  const ist = new Date(date.getTime() + 330 * 60_000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  const two = (n: number) => String(n % 100).padStart(2, "0");
  return `${two(start)}-${two(start + 1)}`;
}

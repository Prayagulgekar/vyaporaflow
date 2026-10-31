import { divRound, multiplyQtyPrice, paise, percentOf, rupees, toScaled, type Decimalish } from "./money";

/**
 * Line pricing. Mirrors app.calc_line() in
 * supabase/migrations/20261028000500_functions_orders.sql. An integration test
 * checks that both produce identical results.
 */
export interface LineInput {
  quantity: Decimalish;
  unitPrice: Decimalish;
  discountPercent: Decimalish;
  taxRate: Decimalish;
  priceIncludesTax: boolean;
}

export interface LineAmounts {
  lineAmount: string;
  discountAmount: string;
  taxableAmount: string;
  taxAmount: string;
  lineTotal: string;
}

export function calcLine(input: LineInput): LineAmounts {
  const lineAmount = multiplyQtyPrice(input.quantity, input.unitPrice);
  const discountAmount = percentOf(lineAmount, input.discountPercent);
  const net = paise(lineAmount) - paise(discountAmount);
  const rate100 = toScaled(input.taxRate, 2); // rate with 2 dp, e.g. 18.00 -> 1800n
  let taxable: bigint;
  let tax: bigint;
  if (input.priceIncludesTax) {
    taxable = divRound(net * 10000n, 10000n + rate100);
    tax = net - taxable;
  } else {
    taxable = net;
    tax = divRound(net * rate100, 10000n);
  }
  return {
    lineAmount,
    discountAmount,
    taxableAmount: rupees(taxable),
    taxAmount: rupees(tax),
    lineTotal: rupees(taxable + tax),
  };
}

export interface OrderTotals {
  subtotal: string;
  discountTotal: string;
  taxableTotal: string;
  taxTotal: string;
  itemsTotal: string;
  deliveryCharge: string;
  grandTotal: string;
}

export interface DeliveryPolicy {
  offersDelivery: boolean;
  deliveryCharge: Decimalish;
  freeDeliveryAbove: Decimalish | null;
}

export function deliveryChargeFor(itemsTotal: Decimalish, policy: DeliveryPolicy): string {
  if (!policy.offersDelivery) return "0.00";
  if (policy.freeDeliveryAbove !== null && paise(itemsTotal) >= paise(policy.freeDeliveryAbove)) return "0.00";
  return rupees(paise(policy.deliveryCharge));
}

export function orderTotals(lines: LineAmounts[], policy: DeliveryPolicy): OrderTotals {
  const sum = (k: keyof LineAmounts) => lines.reduce((s, l) => s + paise(l[k]), 0n);
  const taxable = sum("taxableAmount");
  const tax = sum("taxAmount");
  const items = taxable + tax;
  const delivery = paise(deliveryChargeFor(rupees(items), policy));
  return {
    subtotal: rupees(sum("lineAmount")),
    discountTotal: rupees(sum("discountAmount")),
    taxableTotal: rupees(taxable),
    taxTotal: rupees(tax),
    itemsTotal: rupees(items),
    deliveryCharge: rupees(delivery),
    grandTotal: rupees(items + delivery),
  };
}

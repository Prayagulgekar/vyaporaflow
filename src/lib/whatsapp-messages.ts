/**
 * Prepared WhatsApp messages. Every template takes the real values read from
 * the database and leaves a line out when a value is not available: nothing
 * is estimated or invented. Amounts are formatted as Indian rupees (₹1,23,456.00).
 *
 * The messages are only typed into WhatsApp; the user reviews and sends them.
 */
import { compareMoney, formatINR, subMoney } from "@/domain/money";
import { formatQuantity } from "@/domain/units";
import { formatDate } from "@/lib/format";

type Money = string | number;
type Maybe<T> = T | null | undefined;

/** Joins lines, dropping empty ones, and collapses runs of blank lines. */
function compose(...lines: (string | null | undefined | false)[]): string {
  const out: string[] = [];
  for (const l of lines) {
    if (l === null || l === undefined || l === false) continue;
    if (l === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(l);
  }
  while (out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

function hello(name: Maybe<string>): string {
  const n = name?.trim();
  return n ? `Hello ${n},` : "Hello,";
}

function signOff(business: string, extra?: Maybe<string>): string[] {
  return ["", "Regards,", extra?.trim() ? `${business} (${extra.trim()})` : business];
}

const inr = (v: Money) => formatINR(v);
const has = (v: Maybe<Money>): v is Money => v !== null && v !== undefined && v !== "";
const positive = (v: Maybe<Money>): v is Money => has(v) && compareMoney(v, 0) > 0;
const line = (label: string, value: Maybe<string>) => (value?.toString().trim() ? `${label}: ${value}` : null);
const money = (label: string, value: Maybe<Money>) => (has(value) ? `${label}: ${inr(value)}` : null);
const date = (label: string, value: Maybe<string | Date>) => (value ? `${label}: ${formatDate(value)}` : null);

const ATTACHED = "The PDF is attached to this message.";

// ---------------------------------------------------------------------------
// Orders and deliveries
// ---------------------------------------------------------------------------

export interface OrderMessageData {
  orderNumber: string;
  /** Who receives the message (contact or business name). */
  recipientName?: Maybe<string>;
  /** The business sending the message. */
  senderBusiness: string;
  /** The other business, when it helps the recipient (e.g. the retailer's shop name). */
  counterpartyBusiness?: Maybe<string>;
  placedAt?: Maybe<string | Date>;
  itemsCount?: Maybe<number>;
  orderTotal?: Maybe<Money>;
}

/** 1. Wholesaler to retailer: we have received your order. */
export function orderConfirmationMessage(d: OrderMessageData): string {
  return compose(
    hello(d.recipientName),
    "",
    `Thank you for your order. We have received order ${d.orderNumber}${d.counterpartyBusiness ? ` for ${d.counterpartyBusiness}` : ""}.`,
    date("Placed on", d.placedAt),
    has(d.itemsCount) ? `Items: ${d.itemsCount}` : null,
    money("Order total", d.orderTotal),
    "",
    "We will update you when it is accepted and dispatched.",
    ...signOff(d.senderBusiness),
  );
}

/** 2. Retailer to wholesaler: I have placed a new order. */
export function newOrderNotificationMessage(d: OrderMessageData): string {
  return compose(
    hello(d.recipientName),
    "",
    `I have placed a new order on VyaporaFlow: ${d.orderNumber}.`,
    date("Placed on", d.placedAt),
    has(d.itemsCount) ? `Items: ${d.itemsCount}` : null,
    money("Order total", d.orderTotal),
    "",
    "Please confirm the order.",
    ...signOff(d.senderBusiness),
  );
}

/** 3. Wholesaler to retailer: order accepted. */
export function orderAcceptedMessage(d: OrderMessageData): string {
  return compose(
    hello(d.recipientName),
    "",
    `Your order ${d.orderNumber} has been accepted and is being prepared.`,
    money("Order total", d.orderTotal),
    "",
    "We will let you know when it is dispatched.",
    ...signOff(d.senderBusiness),
  );
}

/** 4. Wholesaler to retailer: order out for delivery. */
export function orderDispatchedMessage(d: OrderMessageData & { deliveryPerson?: Maybe<string>; deliveryPersonPhone?: Maybe<string> }): string {
  return compose(
    hello(d.recipientName),
    "",
    `Your order ${d.orderNumber} has been dispatched and is on its way.`,
    d.deliveryPerson ? `Delivery by: ${d.deliveryPerson}${d.deliveryPersonPhone ? ` (${d.deliveryPersonPhone})` : ""}` : null,
    money("Order total", d.orderTotal),
    ...signOff(d.senderBusiness),
  );
}

/** 5. Wholesaler to retailer: delivered in full. */
export function deliveryCompletedMessage(d: OrderMessageData & { deliveredAt?: Maybe<string | Date>; invoiceNumber?: Maybe<string>; amountDue?: Maybe<Money> }): string {
  return compose(
    hello(d.recipientName),
    "",
    `Your order ${d.orderNumber} has been delivered.`,
    date("Delivered on", d.deliveredAt),
    line("Invoice", d.invoiceNumber),
    positive(d.amountDue) ? money("Amount due", d.amountDue) : null,
    "",
    "Thank you for your business.",
    ...signOff(d.senderBusiness),
  );
}

export interface DeliveredLine {
  name: string;
  ordered: string;
  delivered: string | null;
  unit: string;
}

/** 6. Wholesaler to retailer: delivered in part. Lists only the lines delivered short. */
export function partialDeliveryMessage(d: OrderMessageData & { lines: DeliveredLine[]; deliveredAt?: Maybe<string | Date> }): string {
  const short = d.lines.filter((l) => l.delivered !== null && compareMoney(l.delivered, l.ordered) < 0);
  return compose(
    hello(d.recipientName),
    "",
    `Your order ${d.orderNumber} was delivered in part.`,
    date("Delivered on", d.deliveredAt),
    short.length ? "" : null,
    short.length ? "Items delivered short:" : null,
    ...short.map((l) => `• ${l.name}: ${formatQuantity(l.delivered!, l.unit)} of ${formatQuantity(l.ordered, l.unit)}`),
    "",
    "Your invoice will be for the quantities delivered. Please reply if anything is wrong.",
    ...signOff(d.senderBusiness),
  );
}

/** 7. Wholesaler to retailer: delivery attempt failed. */
export function failedDeliveryMessage(d: OrderMessageData & { reason?: Maybe<string> }): string {
  return compose(
    hello(d.recipientName),
    "",
    `We could not deliver your order ${d.orderNumber} today.`,
    line("Reason noted", d.reason),
    "",
    "Please reply to arrange a new delivery time.",
    ...signOff(d.senderBusiness),
  );
}

/** 15. Wholesaler to delivery partner: new delivery assignment. */
export function deliveryAssignmentMessage(d: {
  workerName?: Maybe<string>;
  senderBusiness: string;
  orderNumber: string;
  retailerName: string;
  retailerContact?: Maybe<string>;
  retailerPhone?: Maybe<string>;
  address?: Maybe<string>;
  itemsCount?: Maybe<number>;
  orderTotal?: Maybe<Money>;
  note?: Maybe<string>;
}): string {
  return compose(
    hello(d.workerName),
    "",
    `You have been assigned delivery of order ${d.orderNumber}.`,
    line("Shop", d.retailerName),
    line("Contact", [d.retailerContact, d.retailerPhone].filter(Boolean).join(", ")),
    line("Address", d.address),
    has(d.itemsCount) ? `Items: ${d.itemsCount}` : null,
    money("Order value", d.orderTotal),
    line("Note", d.note),
    "",
    "Open My deliveries in VyaporaFlow to start the delivery and record any payment collected.",
    ...signOff(d.senderBusiness),
  );
}

// ---------------------------------------------------------------------------
// Invoices, payments and balances
// ---------------------------------------------------------------------------

export interface InvoiceMessageData {
  recipientName?: Maybe<string>;
  senderBusiness: string;
  invoiceNumber: string;
  orderNumber?: Maybe<string>;
  invoiceDate?: Maybe<string>;
  dueDate?: Maybe<string>;
  invoiceTotal: Money;
  amountDue?: Maybe<Money>;
  attached?: boolean;
}

/** 8. Share a GST invoice. */
export function invoiceShareMessage(d: InvoiceMessageData): string {
  return compose(
    hello(d.recipientName),
    "",
    `Please find GST invoice ${d.invoiceNumber}${d.orderNumber ? ` for order ${d.orderNumber}` : ""}.`,
    date("Invoice date", d.invoiceDate),
    money("Invoice total", d.invoiceTotal),
    has(d.amountDue) && compareMoney(d.amountDue, d.invoiceTotal) !== 0 ? money("Amount due", d.amountDue) : null,
    positive(d.amountDue) ? date("Due date", d.dueDate) : null,
    d.attached ? "" : null,
    d.attached ? ATTACHED : null,
    ...signOff(d.senderBusiness),
  );
}

/** 9. Payment reminder for one invoice. */
export function paymentReminderMessage(d: InvoiceMessageData & { overdue?: boolean }): string {
  return compose(
    hello(d.recipientName),
    "",
    d.overdue ? `This is a reminder that invoice ${d.invoiceNumber} is overdue.` : `This is a friendly reminder about invoice ${d.invoiceNumber}.`,
    date("Invoice date", d.invoiceDate),
    money("Invoice total", d.invoiceTotal),
    money("Amount due", d.amountDue),
    date("Due date", d.dueDate),
    "",
    "Please arrange the payment. If you have already paid, please share the payment reference so we can update our records.",
    ...signOff(d.senderBusiness),
  );
}

export interface BalanceMessageData {
  recipientName?: Maybe<string>;
  senderBusiness: string;
  /** Outstanding balance from the retailer balance (positive = owed to the wholesaler). */
  outstanding: Money;
  overdue?: Maybe<Money>;
  oldestDueDate?: Maybe<string>;
  /** Payments received but not yet applied to an invoice. */
  unapplied?: Maybe<Money>;
  asOf?: Maybe<string | Date>;
  attached?: boolean;
}

function balanceLines(d: BalanceMessageData): (string | null)[] {
  const cmp = compareMoney(d.outstanding, 0);
  if (cmp > 0) {
    return [
      money("Outstanding balance", d.outstanding),
      positive(d.overdue) ? money("Overdue", d.overdue) : null,
      positive(d.overdue) ? date("Oldest due date", d.oldestDueDate) : null,
    ];
  }
  if (cmp < 0) return [`Your account has a credit of ${inr(subMoney(0, d.outstanding))} in your favour. No payment is due.`];
  return ["No amount is due on your account."];
}

/** 10. Outstanding balance reminder (also the message sent with the Balance Due PDF). */
export function outstandingBalanceMessage(d: BalanceMessageData): string {
  const owes = compareMoney(d.outstanding, 0) > 0;
  return compose(
    hello(d.recipientName),
    "",
    `Here is your account balance with ${d.senderBusiness}${d.asOf ? ` as on ${formatDate(d.asOf)}` : ""}.`,
    ...balanceLines(d),
    d.attached ? ATTACHED : null,
    owes ? "" : null,
    owes ? "Please arrange the payment at the earliest. If you have already paid, please share the payment reference." : null,
    ...signOff(d.senderBusiness),
  );
}

export interface PaymentMessageData {
  recipientName?: Maybe<string>;
  senderBusiness: string;
  paymentNumber: string;
  amount: Money;
  method?: Maybe<string>;
  reference?: Maybe<string>;
  receivedAt?: Maybe<string | Date>;
  allocations?: { invoiceNumber: string; amount: Money }[];
  unapplied?: Maybe<Money>;
  /** Balance after this payment, when known. */
  outstanding?: Maybe<Money>;
  attached?: boolean;
}

/** 11. Payment received confirmation. */
export function paymentReceivedMessage(d: PaymentMessageData): string {
  return compose(
    hello(d.recipientName),
    "",
    `Thank you. We have received your payment of ${inr(d.amount)}.`,
    line("Receipt no.", d.paymentNumber),
    line("Method", d.method),
    line("Reference", d.reference),
    date("Date", d.receivedAt),
    has(d.outstanding) ? "" : null,
    has(d.outstanding) ? balanceLines({ senderBusiness: d.senderBusiness, outstanding: d.outstanding })[0] : null,
    ...signOff(d.senderBusiness),
  );
}

/** 12. Payment receipt (sent with the receipt PDF). */
export function paymentReceiptMessage(d: PaymentMessageData): string {
  const allocations = d.allocations ?? [];
  return compose(
    hello(d.recipientName),
    "",
    `Payment receipt ${d.paymentNumber} from ${d.senderBusiness}.`,
    money("Amount received", d.amount),
    line("Method", d.method),
    line("Reference", d.reference),
    date("Date", d.receivedAt),
    allocations.length ? "" : null,
    allocations.length ? "Applied to:" : null,
    ...allocations.map((a) => `• Invoice ${a.invoiceNumber}: ${inr(a.amount)}`),
    positive(d.unapplied) ? money("Not yet applied (advance)", d.unapplied) : null,
    d.attached ? "" : null,
    d.attached ? ATTACHED : null,
    ...signOff(d.senderBusiness),
  );
}

/** 13. Account statement sharing. */
export function accountStatementMessage(d: {
  recipientName?: Maybe<string>;
  senderBusiness: string;
  from?: Maybe<string>;
  to?: Maybe<string>;
  openingBalance?: Maybe<Money>;
  closingBalance: Money;
  attached?: boolean;
}): string {
  const period = d.from && d.to ? `for ${formatDate(d.from)} to ${formatDate(d.to)}` : d.to ? `up to ${formatDate(d.to)}` : "";
  return compose(
    hello(d.recipientName),
    "",
    `Please find your account statement with ${d.senderBusiness}${period ? ` ${period}` : ""}.`,
    has(d.openingBalance) ? money("Opening balance", d.openingBalance) : null,
    money("Closing balance", d.closingBalance),
    compareMoney(d.closingBalance, 0) > 0 ? "(Closing balance is the amount owed to us.)" : compareMoney(d.closingBalance, 0) < 0 ? "(A negative balance is a credit in your favour.)" : null,
    d.attached ? "" : null,
    d.attached ? ATTACHED : null,
    "",
    "Please check it and let us know if anything does not match your records.",
    ...signOff(d.senderBusiness),
  );
}

/** 14. Cash (or UPI) collected on delivery: confirmation to the retailer. */
export function cashCollectionMessage(d: {
  recipientName?: Maybe<string>;
  senderBusiness: string;
  collectionNumber: string;
  paymentNumber?: Maybe<string>;
  amount: Money;
  method?: Maybe<string>;
  reference?: Maybe<string>;
  collectedAt?: Maybe<string | Date>;
  collectedBy?: Maybe<string>;
  orderNumber?: Maybe<string>;
  balanceAfter?: Maybe<Money>;
}): string {
  return compose(
    hello(d.recipientName),
    "",
    `This confirms that we received ${inr(d.amount)}${d.orderNumber ? ` on delivery of order ${d.orderNumber}` : ""}.`,
    line("Collection no.", d.collectionNumber),
    line("Receipt no.", d.paymentNumber),
    line("Method", d.method),
    line("Reference", d.reference),
    date("Date", d.collectedAt),
    line("Collected by", d.collectedBy),
    has(d.balanceAfter) ? (positive(d.balanceAfter) ? money("Balance still due on this order", d.balanceAfter) : "Nothing more is due on this order.") : null,
    ...signOff(d.senderBusiness),
  );
}

/** 16. General message. */
export function generalMessage(d: { recipientName?: Maybe<string>; senderBusiness: string; topic?: Maybe<string> }): string {
  return compose(hello(d.recipientName), "", d.topic ? `This is ${d.senderBusiness}, about ${d.topic}.` : `This is ${d.senderBusiness}.`, "");
}

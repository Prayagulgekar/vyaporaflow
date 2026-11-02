/**
 * Builds the list of prepared WhatsApp messages offered on each page, from the
 * data that page already loaded. All wording lives in src/lib/whatsapp-messages.ts.
 */
import { paise, rupees } from "@/domain/money";
import { PAYMENT_METHOD_LABEL } from "@/lib/format";
import {
  accountStatementMessage,
  deliveryAssignmentMessage,
  deliveryCompletedMessage,
  failedDeliveryMessage,
  generalMessage,
  invoiceShareMessage,
  newOrderNotificationMessage,
  orderAcceptedMessage,
  orderConfirmationMessage,
  orderDispatchedMessage,
  outstandingBalanceMessage,
  partialDeliveryMessage,
  paymentReceiptMessage,
  paymentReceivedMessage,
  paymentReminderMessage,
} from "@/lib/whatsapp-messages";
import type { WhatsAppMessageOption } from "@/components/whatsapp";
import type { InvoiceDetail } from "@/server/billing";
import type { OrderDetail } from "@/server/orders";

export const methodLabel = (m: string | null | undefined) => (m ? (PAYMENT_METHOD_LABEL[m] ?? m).replace(" (recorded manually)", "") : null);

/** Wholesaler messaging the retailer about an order. The default follows the order's current state. */
export function wholesalerOrderOptions(order: OrderDetail, business: string): { options: WhatsAppMessageOption[]; defaultId: string } {
  const base = {
    orderNumber: order.order_number,
    recipientName: order.retailer.contact_name ?? order.retailer.name,
    senderBusiness: business,
    counterpartyBusiness: order.retailer.name,
    placedAt: order.placed_at,
    itemsCount: order.items_count,
    orderTotal: order.grand_total,
  };
  const options: WhatsAppMessageOption[] = [{ id: "confirmation", label: "Order confirmation (received)", message: orderConfirmationMessage(base) }];
  const reached = (s: string) => order.events.some((e) => e.to_status === s) || order.status === s;
  if (reached("accepted") && order.status !== "cancelled") options.push({ id: "accepted", label: "Order accepted", message: orderAcceptedMessage(base) });
  if (order.status === "out_for_delivery" || order.dispatched_at) {
    options.push({ id: "dispatched", label: "Order dispatched", message: orderDispatchedMessage({ ...base, deliveryPerson: order.assigned_worker_name }) });
  }
  if (order.delivery_status === "failed") {
    const reason = [...order.delivery_events].reverse().find((e) => e.to_status === "failed")?.note;
    options.push({ id: "failed", label: "Delivery failed", message: failedDeliveryMessage({ ...base, reason }) });
  }
  if (order.status === "delivered") {
    if (order.partially_delivered) {
      options.push({
        id: "partial",
        label: "Partial delivery",
        message: partialDeliveryMessage({
          ...base,
          deliveredAt: order.delivered_at,
          lines: order.items.map((i) => ({ name: `${i.product_name} ${i.variant_name}`.trim(), ordered: i.quantity, delivered: i.delivered_quantity, unit: i.unit_code })),
        }),
      });
    } else {
      options.push({
        id: "delivered",
        label: "Delivery completed",
        message: deliveryCompletedMessage({ ...base, deliveredAt: order.delivered_at, invoiceNumber: order.invoice_number, amountDue: order.invoice_due }),
      });
    }
  }
  options.push({ id: "general", label: "General message", message: generalMessage({ recipientName: base.recipientName, senderBusiness: business, topic: `order ${order.order_number}` }) });
  const byStatus: Record<string, string> = { placed: "confirmation", accepted: "accepted", preparing: "accepted", ready_for_delivery: "accepted", out_for_delivery: "dispatched", cancelled: "general" };
  let defaultId = byStatus[order.status] ?? "general";
  if (order.status === "delivered") defaultId = order.partially_delivered ? "partial" : "delivered";
  if (order.delivery_status === "failed" && order.status !== "delivered") defaultId = "failed";
  if (!options.some((o) => o.id === defaultId)) defaultId = options[0]!.id;
  return { options, defaultId };
}

/** Retailer messaging the wholesaler about an order. */
export function retailerOrderOptions(order: OrderDetail, business: string): WhatsAppMessageOption[] {
  const base = { orderNumber: order.order_number, recipientName: order.wholesaler.name, senderBusiness: business, placedAt: order.placed_at, itemsCount: order.items_count, orderTotal: order.grand_total };
  return [
    { id: "new-order", label: "New order notification", message: newOrderNotificationMessage(base) },
    { id: "general", label: "General message", message: generalMessage({ recipientName: order.wholesaler.name, senderBusiness: business, topic: `my order ${order.order_number}` }) },
  ];
}

/** Wholesaler messaging their delivery partner about an assignment. */
export function deliveryAssignmentOption(order: OrderDetail, business: string, workerName: string | null): WhatsAppMessageOption {
  const a = order.delivery_address;
  return {
    id: "assignment",
    label: "Delivery assignment",
    message: deliveryAssignmentMessage({
      workerName,
      senderBusiness: business,
      orderNumber: order.order_number,
      retailerName: order.retailer.name,
      retailerContact: order.retailer.contact_name,
      retailerPhone: order.retailer.phone,
      address: [a.line1, a.line2, a.city, a.pincode].filter(Boolean).join(", "),
      itemsCount: order.items_count,
      orderTotal: order.grand_total,
    }),
  };
}

/** Wholesaler messaging a retailer about an invoice. */
export function invoiceOptions(inv: InvoiceDetail, recipientName: string | null, opts: { attached?: boolean } = {}): { options: WhatsAppMessageOption[]; defaultId: string } {
  const data = {
    recipientName: recipientName ?? inv.buyer.name,
    senderBusiness: inv.seller.name,
    invoiceNumber: inv.invoice_number,
    orderNumber: inv.order_number,
    invoiceDate: inv.invoice_date,
    dueDate: inv.due_date,
    invoiceTotal: inv.grand_total,
    amountDue: inv.due,
    attached: opts.attached,
  };
  const options: WhatsAppMessageOption[] = [{ id: "invoice", label: "Share invoice", message: invoiceShareMessage(data) }];
  if (inv.status === "issued" && Number(inv.due) > 0) {
    options.push({ id: "reminder", label: inv.payment_status === "overdue" ? "Payment reminder (overdue)" : "Payment reminder", message: paymentReminderMessage({ ...data, attached: false, overdue: inv.payment_status === "overdue" }) });
  }
  return { options, defaultId: "invoice" };
}

export interface RetailerBalanceFacts {
  recipientName: string;
  business: string;
  outstanding: string;
  unapplied: string;
  overdue: string | null;
  oldestDueDate: string | null;
  closingBalance: string;
  asOf: string;
}

/** Wholesaler messaging a retailer about their account. */
export function retailerAccountOptions(f: RetailerBalanceFacts, opts: { attached?: boolean } = {}): WhatsAppMessageOption[] {
  return [
    {
      id: "balance",
      label: "Outstanding balance reminder",
      message: outstandingBalanceMessage({ recipientName: f.recipientName, senderBusiness: f.business, outstanding: f.outstanding, overdue: f.overdue, oldestDueDate: f.oldestDueDate, unapplied: f.unapplied, asOf: f.asOf, attached: opts.attached }),
    },
    {
      id: "statement",
      label: "Account statement",
      message: accountStatementMessage({ recipientName: f.recipientName, senderBusiness: f.business, to: f.asOf, closingBalance: f.closingBalance, attached: opts.attached }),
    },
    { id: "general", label: "General message", message: generalMessage({ recipientName: f.recipientName, senderBusiness: f.business }) },
  ];
}

export interface PaymentFacts {
  payment_number: string;
  amount: string;
  method: string;
  reference: string | null;
  received_at: Date | string;
  unapplied: string;
  allocations: { invoice_number: string; amount: string; reversal: boolean }[];
}

/** Net amount applied to each invoice. Reversal rows are stored as negative amounts, so a plain sum nets them out. */
export function netAllocations(allocations: PaymentFacts["allocations"]): { invoiceNumber: string; amount: string }[] {
  const by = new Map<string, bigint>();
  for (const a of allocations) by.set(a.invoice_number, (by.get(a.invoice_number) ?? 0n) + paise(a.amount));
  return [...by].filter(([, v]) => v !== 0n).map(([invoiceNumber, v]) => ({ invoiceNumber, amount: rupees(v) }));
}

/** Wholesaler messaging a retailer about a payment they made. */
export function paymentOptions(p: PaymentFacts, recipientName: string, business: string, opts: { attached?: boolean } = {}): WhatsAppMessageOption[] {
  const data = {
    recipientName,
    senderBusiness: business,
    paymentNumber: p.payment_number,
    amount: p.amount,
    method: methodLabel(p.method),
    reference: p.reference,
    receivedAt: p.received_at,
    allocations: netAllocations(p.allocations),
    unapplied: p.unapplied,
  };
  return [
    { id: "received", label: "Payment received confirmation", message: paymentReceivedMessage(data) },
    { id: "receipt", label: "Payment receipt", message: paymentReceiptMessage({ ...data, attached: opts.attached }) },
  ];
}

/** A plain greeting, for any contact. */
export function generalMessageOption(recipientName: string | null, business: string, topic?: string): WhatsAppMessageOption {
  return { id: "general", label: "General message", message: generalMessage({ recipientName, senderBusiness: business, topic }) };
}

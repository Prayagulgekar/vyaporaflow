import { describe, expect, it } from "vitest";
import { slicePeriod, monthRange, isIsoDate } from "@/domain/statement-period";
import { whatsappLink } from "@/lib/format";
import { isMobileUserAgent, normalizeWhatsAppPhone, whatsappPhone, whatsappUrl, whatsappUrls } from "@/lib/whatsapp";
import * as M from "@/lib/whatsapp-messages";
import { netAllocations, paymentOptions, wholesalerOrderOptions } from "@/features/shared/whatsapp-options";
import type { OrderDetail } from "@/server/orders";

describe("Indian phone numbers for WhatsApp", () => {
  it.each([
    ["9876543210", "919876543210"],
    ["98765 43210", "919876543210"],
    ["98765-43210", "919876543210"],
    ["(98765) 43210", "919876543210"],
    ["09876543210", "919876543210"],
    ["+91 98765 43210", "919876543210"],
    ["+91-98765-43210", "919876543210"],
    ["+919876543210", "919876543210"],
    ["91 9876543210", "919876543210"],
    ["919876543210", "919876543210"],
    ["0091 98765 43210", "919876543210"],
    ["+91 (0) 98765 43210", "919876543210"],
    ["+9876543210", "919876543210"],
    ["  6000012345 ", "916000012345"],
  ])("%s -> %s", (input, digits) => {
    const r = normalizeWhatsAppPhone(input);
    expect(r.ok && r.digits).toBe(digits);
    expect(r.ok && r.display).toBe(`+91 ${digits.slice(2, 7)} ${digits.slice(7)}`);
  });

  it("accepts other countries only in + international form", () => {
    expect(whatsappPhone("+1 415 555 0100")).toBe("14155550100");
    expect(whatsappPhone("+971 50 123 4567")).toBe("971501234567");
    expect(whatsappPhone("14155550100")).toBeNull(); // no + and not Indian: ambiguous
  });

  it.each([
    ["", "missing"],
    [null, "missing"],
    [undefined, "missing"],
    ["   ", "missing"],
    ["12345", "invalid"],
    ["5876543210", "invalid"], // Indian mobiles start with 6-9
    ["020 2612 3456", "invalid"], // Pune landline
    ["+91 98765 4321", "invalid"],
    ["+91 98765 432100", "invalid"],
    ["98765abc10", "invalid"],
  ])("rejects %j as %s with a useful message", (input, reason) => {
    const r = normalizeWhatsAppPhone(input as string, "Ganesh Stores");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe(reason);
      expect(r.error).toContain("Ganesh Stores");
      if (reason === "invalid") expect(r.error).toMatch(/not a valid mobile number/);
      else expect(r.error).toMatch(/No phone number is saved/);
    }
  });

  it("never produces a link for a missing or invalid number", () => {
    expect(whatsappUrl(null, "Hi")).toBeNull();
    expect(whatsappUrl("12345", "Hi")).toBeNull();
    expect(whatsappLink("020 2612 3456", "Hi")).toBeNull();
  });
});

describe("WhatsApp links", () => {
  it("keeps the existing wa.me format", () => {
    expect(whatsappLink("98765 43210", "Hi")).toBe("https://wa.me/919876543210?text=Hi");
  });

  it("encodes the message as UTF-8 so ₹, line breaks and special characters survive", () => {
    const msg = "Hello Shree Ganesh & Sons,\nDue: ₹1,23,456.78 #INV/26-27/00004? 50% done 👍 'quotes' \"double\" +plus =eq";
    const { mobile, desktop } = whatsappUrls("919876543210", msg);
    const m = new URL(mobile);
    expect(m.origin + m.pathname).toBe("https://wa.me/919876543210");
    expect(m.searchParams.get("text")).toBe(msg);
    expect(mobile).not.toMatch(/\s/); // no raw whitespace or line breaks in the URL
    expect(mobile).toContain("%E2%82%B9"); // ₹
    expect(mobile).toContain("%0A"); // line break
    expect(mobile).toContain("%26"); // & does not end the text parameter
    expect(mobile).toContain("%23"); // # does not start a fragment
    expect(mobile).toContain("%2B"); // + is not read as a space
    const d = new URL(desktop);
    expect(d.origin + d.pathname).toBe("https://web.whatsapp.com/send");
    expect(d.searchParams.get("phone")).toBe("919876543210");
    expect(d.searchParams.get("text")).toBe(msg);
  });

  it("detects phones and tablets", () => {
    expect(isMobileUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile Safari")).toBe(true);
    expect(isMobileUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(true);
    expect(isMobileUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true); // iPad desktop mode
    expect(isMobileUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130")).toBe(false);
    expect(isMobileUserAgent("anything", 0, true)).toBe(true);
  });
});

const BIZ = "Sahyadri Snacks & Beverages";

describe("message templates", () => {
  const order = { orderNumber: "SSB-00042", recipientName: "Meera", senderBusiness: BIZ, counterpartyBusiness: "Shree Ganesh Kirana", placedAt: "2026-10-30", itemsCount: 3, orderTotal: "12345.5" };

  it("1. order confirmation uses the real order data", () => {
    const m = M.orderConfirmationMessage(order);
    expect(m).toContain("Hello Meera,");
    expect(m).toContain("SSB-00042");
    expect(m).toContain("Shree Ganesh Kirana");
    expect(m).toContain("30 Oct 2026");
    expect(m).toContain("Items: 3");
    expect(m).toContain("Order total: ₹12,345.50");
    expect(m.trim().endsWith(BIZ)).toBe(true);
  });

  it("2-4. new order, accepted and dispatched", () => {
    expect(M.newOrderNotificationMessage({ ...order, recipientName: BIZ, senderBusiness: "Shree Ganesh Kirana" })).toMatch(/I have placed a new order on VyaporaFlow: SSB-00042\./);
    expect(M.orderAcceptedMessage(order)).toMatch(/SSB-00042 has been accepted/);
    const d = M.orderDispatchedMessage({ ...order, deliveryPerson: "Ravi", deliveryPersonPhone: "+91 90000 02001" });
    expect(d).toMatch(/dispatched/);
    expect(d).toContain("Delivery by: Ravi (+91 90000 02001)");
  });

  it("5. delivery completed shows amount due only when something is due", () => {
    expect(M.deliveryCompletedMessage({ ...order, deliveredAt: "2026-11-01", invoiceNumber: "INV/26-27/00004", amountDue: "500" })).toContain("Amount due: ₹500.00");
    expect(M.deliveryCompletedMessage({ ...order, amountDue: "0.00" })).not.toContain("Amount due");
    expect(M.deliveryCompletedMessage({ ...order, amountDue: null })).not.toContain("Amount due");
  });

  it("6. partial delivery lists only the short lines", () => {
    const m = M.partialDeliveryMessage({
      ...order,
      lines: [
        { name: "Parle-G 100 g", ordered: "10", delivered: "8", unit: "box" },
        { name: "Tea 1 kg", ordered: "5", delivered: "5", unit: "packet" },
        { name: "Sugar", ordered: "2", delivered: null, unit: "bag" },
      ],
    });
    expect(m).toContain("• Parle-G 100 g: 8 box of 10 box");
    expect(m).not.toContain("Tea 1 kg");
    expect(m).not.toContain("Sugar");
  });

  it("7. failed delivery includes the recorded reason, or none", () => {
    expect(M.failedDeliveryMessage({ ...order, reason: "Shop closed" })).toContain("Reason noted: Shop closed");
    expect(M.failedDeliveryMessage({ ...order })).not.toContain("Reason");
  });

  const inv = { recipientName: "Meera", senderBusiness: BIZ, invoiceNumber: "INV/26-27/00004", orderNumber: "SSB-00042", invoiceDate: "2026-10-05", dueDate: "2026-10-20", invoiceTotal: "2155.92", amountDue: "861.92" };

  it("8. invoice sharing", () => {
    const m = M.invoiceShareMessage({ ...inv, attached: true });
    expect(m).toContain("GST invoice INV/26-27/00004 for order SSB-00042");
    expect(m).toContain("Invoice total: ₹2,155.92");
    expect(m).toContain("Amount due: ₹861.92");
    expect(m).toContain("Due date: 20 Oct 2026");
    expect(m).toContain("The PDF is attached");
    const paid = M.invoiceShareMessage({ ...inv, amountDue: "0.00" });
    expect(paid).not.toContain("Due date");
    expect(M.invoiceShareMessage(inv)).not.toContain("attached");
  });

  it("9. payment reminder", () => {
    const m = M.paymentReminderMessage({ ...inv, overdue: true });
    expect(m).toMatch(/is overdue/);
    expect(m).toContain("Amount due: ₹861.92");
  });

  it("10. outstanding balance: owed, credit and zero", () => {
    const owed = M.outstandingBalanceMessage({ recipientName: "Meera", senderBusiness: BIZ, outstanding: "6450.76", overdue: "2893.92", oldestDueDate: "2026-10-20", asOf: "2026-11-02" });
    expect(owed).toContain("Outstanding balance: ₹6,450.76");
    expect(owed).toContain("Overdue: ₹2,893.92");
    expect(owed).toContain("Oldest due date: 20 Oct 2026");
    expect(owed).toContain("as on 2 Nov 2026");
    expect(owed).toContain("Please arrange the payment");
    const credit = M.outstandingBalanceMessage({ senderBusiness: BIZ, outstanding: "-300.00" });
    expect(credit).toContain("credit of ₹300.00 in your favour");
    expect(credit).not.toContain("Please arrange");
    expect(credit.startsWith("Hello,")).toBe(true);
    expect(M.outstandingBalanceMessage({ senderBusiness: BIZ, outstanding: "0" })).toContain("No amount is due");
    // No overdue line when nothing is overdue.
    expect(M.outstandingBalanceMessage({ senderBusiness: BIZ, outstanding: "100", overdue: "0.00" })).not.toContain("Overdue");
  });

  it("11-12. payment received and receipt", () => {
    const p = { recipientName: "Meera", senderBusiness: BIZ, paymentNumber: "RCPT-000007", amount: "2000", method: "UPI", reference: "UPI/REF & 42", receivedAt: "2026-11-02", allocations: [{ invoiceNumber: "INV/26-27/00004", amount: "861.92" }], unapplied: "1138.08" };
    const r = M.paymentReceivedMessage(p);
    expect(r).toContain("received your payment of ₹2,000.00");
    expect(r).toContain("Reference: UPI/REF & 42");
    const rc = M.paymentReceiptMessage({ ...p, attached: true });
    expect(rc).toContain("• Invoice INV/26-27/00004: ₹861.92");
    expect(rc).toContain("Not yet applied (advance): ₹1,138.08");
    expect(rc).toContain("The PDF is attached");
    expect(M.paymentReceiptMessage({ ...p, unapplied: "0.00" })).not.toContain("advance");
  });

  it("13. account statement", () => {
    const m = M.accountStatementMessage({ recipientName: "Meera", senderBusiness: BIZ, from: "2026-10-01", to: "2026-10-31", openingBalance: "100", closingBalance: "2500.5", attached: true });
    expect(m).toContain("for 1 Oct 2026 to 31 Oct 2026");
    expect(m).toContain("Opening balance: ₹100.00");
    expect(m).toContain("Closing balance: ₹2,500.50");
  });

  it("14. cash collection confirmation", () => {
    const m = M.cashCollectionMessage({ recipientName: "Meera", senderBusiness: BIZ, collectionNumber: "COL-000003", paymentNumber: "RCPT-000010", amount: "100", method: "Cash", collectedAt: "2026-11-02", collectedBy: "Ravi", orderNumber: "SSB-00042", balanceAfter: "100" });
    expect(m).toContain("received ₹100.00 on delivery of order SSB-00042");
    expect(m).toContain("Collected by: Ravi");
    expect(m).toContain("Balance still due on this order: ₹100.00");
    expect(M.cashCollectionMessage({ senderBusiness: BIZ, collectionNumber: "C", amount: "1", balanceAfter: "0.00" })).toContain("Nothing more is due");
  });

  it("15. delivery partner assignment", () => {
    const m = M.deliveryAssignmentMessage({ workerName: "Ravi", senderBusiness: BIZ, orderNumber: "SSB-00042", retailerName: "Shree Ganesh Kirana", retailerContact: "Meera", retailerPhone: "9000001001", address: "Shop 7, Paud Road, Pune 411038", itemsCount: 3, orderTotal: "500" });
    expect(m).toContain("Hello Ravi,");
    expect(m).toContain("Shop: Shree Ganesh Kirana");
    expect(m).toContain("Contact: Meera, 9000001001");
    expect(m).toContain("Address: Shop 7, Paud Road, Pune 411038");
    expect(m).toContain("Order value: ₹500.00");
  });

  it("16. general message", () => {
    expect(M.generalMessage({ recipientName: "Meera", senderBusiness: BIZ })).toBe(`Hello Meera,\n\nThis is ${BIZ}.`);
  });

  it("never prints a figure that was not supplied", () => {
    const all = [
      M.orderConfirmationMessage({ orderNumber: "X-1", senderBusiness: BIZ }),
      M.orderAcceptedMessage({ orderNumber: "X-1", senderBusiness: BIZ }),
      M.orderDispatchedMessage({ orderNumber: "X-1", senderBusiness: BIZ }),
      M.deliveryCompletedMessage({ orderNumber: "X-1", senderBusiness: BIZ }),
      M.failedDeliveryMessage({ orderNumber: "X-1", senderBusiness: BIZ }),
      M.deliveryAssignmentMessage({ senderBusiness: BIZ, orderNumber: "X-1", retailerName: "Shop" }),
      M.generalMessage({ senderBusiness: BIZ }),
    ];
    for (const m of all) {
      expect(m).not.toMatch(/₹/);
      expect(m).not.toMatch(/undefined|null|NaN/);
    }
    for (const m of [M.invoiceShareMessage(inv), M.outstandingBalanceMessage({ senderBusiness: BIZ, outstanding: "1" })]) expect(m).not.toMatch(/undefined|null|NaN/);
  });
});

describe("page message options", () => {
  const baseOrder = {
    id: "o1", order_number: "SSB-00042", status: "delivered", partially_delivered: true, placed_at: new Date("2026-10-30T10:00:00Z"), items_count: 2, grand_total: "500.00",
    delivered_at: new Date("2026-11-01T10:00:00Z"), dispatched_at: new Date("2026-10-31T10:00:00Z"), delivery_status: "partially_delivered", invoice_number: null, invoice_due: null,
    assigned_worker_name: "Ravi", retailer: { name: "Shree Ganesh Kirana", contact_name: "Meera", phone: "9000001001", gstin: null }, wholesaler: { name: BIZ, phone: null, whatsapp: null },
    items: [{ product_name: "Parle-G", variant_name: "100 g", quantity: "10", delivered_quantity: "8", unit_code: "box" }], events: [{ to_status: "accepted" }], delivery_events: [], delivery_address: { line1: "Shop 7", city: "Pune", state_code: "27", pincode: "411038" },
  } as unknown as OrderDetail;

  it("defaults to the message for the order's state", () => {
    expect(wholesalerOrderOptions(baseOrder, BIZ).defaultId).toBe("partial");
    expect(wholesalerOrderOptions({ ...baseOrder, status: "placed", dispatched_at: null, delivery_status: null, events: [] } as unknown as OrderDetail, BIZ).defaultId).toBe("confirmation");
    expect(wholesalerOrderOptions({ ...baseOrder, status: "out_for_delivery", delivery_status: "out_for_delivery" } as unknown as OrderDetail, BIZ).defaultId).toBe("dispatched");
    const failed = wholesalerOrderOptions({ ...baseOrder, status: "ready_for_delivery", delivery_status: "failed", delivery_events: [{ to_status: "failed", note: "Shop closed" }] } as unknown as OrderDetail, BIZ);
    expect(failed.defaultId).toBe("failed");
    expect(failed.options.find((o) => o.id === "failed")!.message).toContain("Shop closed");
  });

  it("nets payment allocations against their reversals, to the paisa", () => {
    expect(netAllocations([
      { invoice_number: "A", amount: "100.10", reversal: false },
      { invoice_number: "B", amount: "50.00", reversal: false },
      { invoice_number: "A", amount: "-100.10", reversal: true },
      { invoice_number: "B", amount: "0.05", reversal: false },
    ])).toEqual([{ invoiceNumber: "B", amount: "50.05" }]);
  });

  it("payment options carry the real amount and method", () => {
    const opts = paymentOptions({ payment_number: "RCPT-1", amount: "2000.00", method: "upi", reference: "R1", received_at: "2026-11-02", unapplied: "0.00", allocations: [] }, "Meera", BIZ);
    expect(opts.map((o) => o.id)).toEqual(["received", "receipt"]);
    expect(opts[0]!.message).toContain("₹2,000.00");
    expect(opts[0]!.message).toContain("Method: UPI");
  });
});

describe("statement periods", () => {
  const lines = [
    { date: "2026-09-10", debit: "1000.00", credit: "0", balance: "1000.00" },
    { date: "2026-09-25", debit: "0", credit: "400.00", balance: "600.00" },
    { date: "2026-10-05", debit: "250.50", credit: "0", balance: "850.50" },
    { date: "2026-10-31", debit: "0", credit: "50.50", balance: "800.00" },
    { date: "2026-11-01", debit: "100.00", credit: "0", balance: "900.00" },
  ];

  it("takes the opening balance from the last line before the period", () => {
    const p = slicePeriod(lines, "2026-10-01", "2026-10-31");
    expect(p.opening).toBe("600.00");
    expect(p.lines.map((l) => l.date)).toEqual(["2026-10-05", "2026-10-31"]);
    expect(p.debit).toBe("250.50");
    expect(p.credit).toBe("50.50");
    expect(p.closing).toBe("800.00");
  });

  it("an empty period keeps the opening balance as the closing balance", () => {
    const p = slicePeriod(lines, "2026-10-06", "2026-10-30");
    expect(p.lines).toEqual([]);
    expect(p.opening).toBe("850.50");
    expect(p.closing).toBe("850.50");
    const none = slicePeriod([], null, null);
    expect(none).toMatchObject({ opening: "0.00", closing: "0.00", debit: "0.00", credit: "0.00" });
  });

  it("open-ended ranges", () => {
    expect(slicePeriod(lines, null, null).closing).toBe("900.00");
    expect(slicePeriod(lines, null, "2026-09-30").closing).toBe("600.00");
    expect(slicePeriod(lines, "2026-11-01", null).opening).toBe("800.00");
  });

  it("month ranges and date validation", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(monthRange("2026-13")).toBeNull();
    expect(monthRange("26-01")).toBeNull();
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-1-01")).toBe(false);
  });
});

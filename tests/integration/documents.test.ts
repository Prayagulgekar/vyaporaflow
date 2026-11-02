/**
 * Integration: PDF documents (balance due, account statement, monthly
 * statement, GST invoice, payment receipt). Data is read through the real
 * server modules as real users, so RLS applies. The figures in each document
 * model are compared with the existing views and statement, and the rendered
 * PDFs are checked for page count and, where `pdftotext` is installed
 * (poppler-utils), for the text actually printed.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDS, freshDatabase, key, makeProduct, rejects, type TestDb } from "../support/test-db";
import { addMoney, formatINR, subMoney } from "@/domain/money";
import { generateInvoice, getStatement, recordPayment } from "@/server/billing";
import { assignDelivery, updateDelivery } from "@/server/deliveries";
import { placeOrder, transitionOrder } from "@/server/orders";
import {
  loadBalanceDue,
  loadInvoicePdf,
  loadReceipt,
  loadStatement,
  renderBalanceDue,
  renderReceipt,
  renderStatement,
  resolveStatementPeriod,
  type PdfFile,
} from "@/server/documents";

let t: TestDb;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const HAS_PDFTOTEXT = spawnSync("pdftotext", ["-v"]).status === 0;
const OUT = process.env.PDF_OUT; // set to a folder to keep the generated PDFs for inspection

async function inspect(file: PdfFile): Promise<{ pages: number; text: string | null }> {
  const doc = await PDFDocument.load(file.bytes);
  expect(Buffer.from(file.bytes.slice(0, 5)).toString()).toBe("%PDF-");
  expect(file.filename).toMatch(/^[A-Za-z0-9-]+\.pdf$/);
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, file.filename), file.bytes);
  }
  let text: string | null = null;
  if (HAS_PDFTOTEXT) {
    const r = spawnSync("pdftotext", ["-layout", "-", "-"], { input: Buffer.from(file.bytes) });
    text = r.stdout.toString();
  }
  return { pages: doc.getPageCount(), text };
}

async function retailerBalance(wholesaler: string, retailer: string) {
  const [r] = await t.service((q) =>
    q.query<{ invoiced: string; credited: string; received: string; outstanding: string; unapplied: string }>(
      "select invoiced::text, credited::text, received::text, outstanding::text, unapplied::text from public.retailer_balances where wholesaler_id = $1 and retailer_id = $2",
      [wholesaler, retailer],
    ),
  );
  return r!;
}

/** Deliver an order of `qty` pieces and invoice it. Returns the invoice id. */
async function invoicedOrder(variantUnitId: string, qty: string) {
  const orderId = await placeOrder(IDS.omsaiOwner, { retailer_id: IDS.omsai, wholesaler_id: IDS.sahyadri, items: [{ variant_unit_id: variantUnitId, quantity: qty }], idempotency_key: key("ord") });
  for (const s of ["accepted", "preparing", "ready_for_delivery"]) await transitionOrder(IDS.sahyadriOwner, orderId, s);
  const deliveryId = await assignDelivery(IDS.sahyadriOwner, orderId, IDS.ravi);
  await updateDelivery(IDS.ravi, { delivery_id: deliveryId, to: "out_for_delivery" });
  await updateDelivery(IDS.ravi, { delivery_id: deliveryId, to: "delivered" });
  return generateInvoice(IDS.sahyadriOwner, orderId);
}

let invoiceId: string;
let paymentId: string;
let before: Awaited<ReturnType<typeof retailerBalance>>;

beforeAll(async () => {
  t = await freshDatabase();
  await t.service((q) =>
    q.query("update public.wholesaler_profiles set min_order_value = 0, delivery_charge = 0, free_delivery_above = null where company_id = $1", [IDS.sahyadri]),
  );
  const product = await makeProduct(t, IDS.sahyadriOwner, IDS.sahyadri, { stock: "1000", price: "1234.50", taxRate: "18.00" });
  // Make sure Om Sai is an approved customer of Sahyadri.
  await t.service((q) =>
    q.query(
      `insert into public.retailer_wholesaler_relationships (wholesaler_id, retailer_id, status) values ($1, $2, 'approved')
       on conflict (wholesaler_id, retailer_id) do update set status = 'approved'`,
      [IDS.sahyadri, IDS.omsai],
    ),
  );
  before = await retailerBalance(IDS.sahyadri, IDS.omsai);
  invoiceId = await invoicedOrder(product.variant_unit_id, "3");
  paymentId = await recordPayment(IDS.sahyadriOwner, {
    wholesaler_id: IDS.sahyadri,
    retailer_id: IDS.omsai,
    amount: "2000.00",
    method: "upi",
    reference: "UPI/REF & 42",
    received_on: today(),
    idempotency_key: key("pay"),
    allocation_mode: "auto",
  });
});
afterAll(async () => t?.close());

describe("balance due PDF", () => {
  it("uses the retailer balance figures and lists open invoices with due dates", async () => {
    const m = await loadBalanceDue(IDS.sahyadriOwner, IDS.sahyadri, IDS.ganesh);
    const rb = await retailerBalance(IDS.sahyadri, IDS.ganesh);
    expect({ invoiced: m.invoiced, credited: m.credited, received: m.received, outstanding: m.outstanding, unapplied: m.unapplied }).toEqual(rb);
    // The statement's running balance agrees with the balance view.
    expect(m.statementBalance).toBe(rb.outstanding);
    const [od] = await t.service((q) =>
      q.query<{ overdue: string }>(
        "select coalesce(sum(due), 0)::text as overdue from public.invoice_balances where wholesaler_id = $1 and retailer_id = $2 and payment_status = 'overdue'",
        [IDS.sahyadri, IDS.ganesh],
      ),
    );
    expect(addMoney(m.overdue)).toBe(addMoney(od!.overdue));
    for (const i of m.openInvoices) expect(Number(i.due)).toBeGreaterThan(0);

    const file = await renderBalanceDue(m);
    expect(file.filename).toMatch(new RegExp(`^Balance-Due-[A-Za-z0-9-]+-${today()}\\.pdf$`));
    const { pages, text } = await inspect(file);
    expect(pages).toBeGreaterThanOrEqual(1);
    if (text) {
      expect(text).toContain("BALANCE DUE STATEMENT");
      expect(text).toContain("not a tax invoice");
      expect(text).toContain(formatINR(m.outstanding));
      expect(text).toContain(formatINR(m.invoiced));
      for (const i of m.openInvoices) expect(text).toContain(i.invoice_number);
    }
  });

  it("moves by exactly the new invoice and payment, to the paisa", async () => {
    const m = await loadBalanceDue(IDS.sahyadriOwner, IDS.sahyadri, IDS.omsai);
    // 3 × ₹1,234.50 + 18% GST = ₹4,370.13 invoiced; ₹2,000 paid by UPI.
    expect(m.invoiced).toBe(addMoney(before.invoiced, "4370.13"));
    expect(m.received).toBe(addMoney(before.received, "2000.00"));
    expect(m.outstanding).toBe(addMoney(before.outstanding, "2370.13"));
    const { text } = await inspect(await renderBalanceDue(m));
    if (text) {
      expect(text).toContain(formatINR(m.invoiced));
      expect(text).toContain(formatINR(m.outstanding));
      expect(text).toContain("₹4,370.13"); // the new invoice's line
    }
  });

  it("is refused for another wholesaler's customer (RLS)", async () => {
    const err = await rejects(loadBalanceDue(IDS.annapurnaOwner, IDS.sahyadri, IDS.omsai));
    expect(err.message).toMatch(/not found/i);
  });
});

describe("account statement PDF", () => {
  it("full statement closes at the statement balance", async () => {
    const s = await getStatement(IDS.sahyadriOwner, IDS.sahyadri, IDS.ganesh);
    const m = await loadStatement(IDS.sahyadriOwner, IDS.sahyadri, IDS.ganesh, { from: null, to: null });
    expect(m.period.opening).toBe("0.00");
    expect(m.period.closing).toBe(s.totals.balance);
    expect(m.period.debit).toBe(s.totals.debit);
    expect(m.period.credit).toBe(s.totals.credit);
    const { text } = await inspect(await renderStatement(m));
    if (text) {
      expect(text).toContain("ACCOUNT STATEMENT");
      expect(text).toContain("Opening balance");
      expect(text).toContain("Closing balance");
      for (const l of s.lines) expect(text).toContain(l.reference);
    }
  });

  it("a date range carries the opening balance and ties out", async () => {
    const s = await getStatement(IDS.sahyadriOwner, IDS.sahyadri, IDS.ganesh);
    const dates = [...new Set(s.lines.map((l) => l.date))].sort();
    const from = dates[Math.floor(dates.length / 2)]!;
    const m = await loadStatement(IDS.sahyadriOwner, IDS.sahyadri, IDS.ganesh, { from, to: null });
    const before = s.lines.filter((l) => l.date < from);
    expect(m.period.opening).toBe(before.length ? before[before.length - 1]!.balance : "0.00");
    expect(addMoney(subMoney(m.period.opening, m.period.credit), m.period.debit)).toBe(m.period.closing);
    expect(m.period.lines.every((l) => l.date >= from)).toBe(true);
  });

  it("monthly statement for a month with no transactions renders an empty statement", async () => {
    const range = resolveStatementPeriod({ month: "2001-02" });
    expect(range).toEqual({ from: "2001-02-01", to: "2001-02-28", monthly: true });
    const m = await loadStatement(IDS.sahyadriOwner, IDS.sahyadri, IDS.ganesh, range);
    expect(m.period.lines).toEqual([]);
    expect(m.period.opening).toBe("0.00");
    expect(m.period.closing).toBe("0.00");
    const file = await renderStatement(m);
    expect(file.filename).toMatch(/^Monthly-Statement-.+-2001-02-01-to-2001-02-28\.pdf$/);
    const { pages, text } = await inspect(file);
    expect(pages).toBe(1);
    if (text) expect(text).toContain("No transactions in this period.");
  });

  it("rejects invalid periods", async () => {
    expect(() => resolveStatementPeriod({ month: "2026-13" })).toThrow(/valid month/);
    expect(() => resolveStatementPeriod({ from: "2026-02-30" })).toThrow(/valid/);
    expect(() => resolveStatementPeriod({ from: "2026-03-02", to: "2026-03-01" })).toThrow(/on or before/);
  });

  it("long statements run onto several pages with the table header repeated", async () => {
    for (let i = 0; i < 70; i++) {
      await recordPayment(IDS.sahyadriOwner, {
        wholesaler_id: IDS.sahyadri,
        retailer_id: IDS.omsai,
        amount: "1.00",
        method: "cash",
        received_on: today(),
        idempotency_key: key("many"),
        allocation_mode: "none",
      });
    }
    const m = await loadStatement(IDS.sahyadriOwner, IDS.sahyadri, IDS.omsai, { from: null, to: null });
    expect(m.period.lines.length).toBeGreaterThan(70);
    expect(m.period.closing).toBe((await retailerBalance(IDS.sahyadri, IDS.omsai)).outstanding);
    const { pages, text } = await inspect(await renderStatement(m));
    expect(pages).toBeGreaterThan(1);
    if (text) {
      expect(text).toContain(`Page ${pages} of ${pages}`);
      expect(text.match(/Reference/g)!.length).toBeGreaterThanOrEqual(pages);
      expect(text).toContain("(continued)");
    }
  });
});

describe("GST invoice PDF", () => {
  it("prints the stored invoice values: GSTIN, HSN, taxable value, CGST/SGST and total", async () => {
    const { inv, file } = await loadInvoicePdf(IDS.sahyadriOwner, invoiceId);
    expect(file.filename).toBe(`Tax-Invoice-${inv.invoice_number.replace(/[^\w-]+/g, "-")}.pdf`);
    expect(inv.grand_total).toBe("4370.13");
    const { pages, text } = await inspect(file);
    expect(pages).toBe(1);
    if (text) {
      expect(text).toContain("TAX INVOICE");
      expect(text).toContain(inv.invoice_number);
      expect(text).toContain("1905");
      expect(text).toContain(formatINR(inv.taxable_total));
      expect(text).toContain(formatINR(inv.grand_total));
      if (inv.supply_type === "intra_state") {
        expect(text).toContain(formatINR(inv.cgst_total));
        expect(text).toContain(formatINR(inv.sgst_total));
      } else expect(text).toContain(formatINR(inv.igst_total));
      if (inv.seller.gstin) expect(text).toContain(inv.seller.gstin);
      expect(text).toContain("not an e-invoice");
    }
  });

  it("the retailer can download their own invoice, another retailer cannot", async () => {
    await expect(loadInvoicePdf(IDS.omsaiOwner, invoiceId)).resolves.toBeTruthy();
    const err = await rejects(loadInvoicePdf(IDS.ganeshOwner, invoiceId));
    expect(err.message).toMatch(/not found/i);
  });
});

describe("payment receipt PDF", () => {
  it("shows the payment, method, reference and the invoices it was applied to", async () => {
    const m = await loadReceipt(IDS.sahyadriOwner, paymentId);
    expect(m.payment.amount).toBe("2000.00");
    expect(m.payment.allocations.length).toBeGreaterThanOrEqual(1); // oldest invoices first
    const file = await renderReceipt(m);
    expect(file.filename).toBe(`Payment-Receipt-${m.payment.payment_number.replace(/[^\w-]+/g, "-")}.pdf`);
    const { text } = await inspect(file);
    if (text) {
      expect(text).toContain("PAYMENT RECEIPT");
      expect(text).toContain(m.payment.payment_number);
      expect(text).toContain("₹2,000.00");
      expect(text).toContain("UPI/REF & 42");
      for (const a of m.payment.allocations) expect(text).toContain(a.invoice_number);
    }
  });

  it("an unapplied payment is shown as an advance", async () => {
    const id = await recordPayment(IDS.sahyadriOwner, { wholesaler_id: IDS.sahyadri, retailer_id: IDS.omsai, amount: "500.00", method: "cash", received_on: today(), idempotency_key: key("adv"), allocation_mode: "none" });
    const m = await loadReceipt(IDS.sahyadriOwner, id);
    expect(m.payment.unapplied).toBe("500.00");
    const { text } = await inspect(await renderReceipt(m));
    if (text) expect(text).toContain("held as an advance");
  });

  it("another wholesaler cannot open the receipt", async () => {
    const err = await rejects(loadReceipt(IDS.annapurnaOwner, paymentId));
    expect(err.message).toMatch(/not found/i);
  });
});

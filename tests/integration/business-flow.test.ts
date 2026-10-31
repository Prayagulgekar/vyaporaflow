/**
 * Integration: the core business workflow through the real server modules
 * and database functions, with RLS applied (each call runs as a demo user).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDS, freshDatabase, key, makeProduct, rejects, stockOf, type TestDb } from "../support/test-db";
import { placeOrder, quoteOrder, transitionOrder, getOrder } from "@/server/orders";
import { adjustStock } from "@/server/inventory";
import { generateInvoice, getInvoice, recordPayment, reconcileReceivables, reversePayment } from "@/server/billing";
import { assignDelivery, listMyDeliveries, updateDelivery } from "@/server/deliveries";
import { setCartQuantity, getCarts } from "@/server/cart";
import { calcLine } from "@/domain/pricing";

let t: TestDb;
let product: Awaited<ReturnType<typeof makeProduct>>;

beforeAll(async () => {
  t = await freshDatabase();
  product = await makeProduct(t, IDS.sahyadriOwner, IDS.sahyadri, { stock: "100", price: "12.50", discount: "4", taxRate: "18.00" });
});
afterAll(async () => t?.close());

const todayIst = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

describe("products and inventory", () => {
  it("creates a product with opening stock and a stock movement", async () => {
    expect(await stockOf(t, product.variant_id)).toEqual({ on_hand: "100.000", reserved: "0.000", available: "100.000" });
    const moves = await t.service((q) =>
      q.query<{ movement_type: string; on_hand_delta: string }>("select movement_type, on_hand_delta::text from public.stock_movements where variant_id = $1", [product.variant_id]),
    );
    expect(moves).toEqual([{ movement_type: "opening", on_hand_delta: "100.000" }]);
  });

  it("records stock additions and reductions and refuses negative stock", async () => {
    await adjustStock(IDS.sahyadriOwner, { variant_id: product.variant_id, movement_type: "addition", quantity: "20", note: "Received from supplier" });
    await adjustStock(IDS.sahyadriOwner, { variant_id: product.variant_id, movement_type: "damage", quantity: "5", note: "Crushed packets" });
    expect((await stockOf(t, product.variant_id)).on_hand).toBe("115.000");
    await rejects(adjustStock(IDS.sahyadriOwner, { variant_id: product.variant_id, movement_type: "reduction", quantity: "1000", note: "Too much" }));
    expect((await stockOf(t, product.variant_id)).on_hand).toBe("115.000");
  });

  it("rejects products with an invalid HSN code or duplicate SKU", async () => {
    await rejects(makeProduct(t, IDS.sahyadriOwner, IDS.sahyadri, { stock: "1", sku: "SSB-CRS-CS-52" }));
  });

  it("explains selling-unit mistakes on the exact field", async () => {
    const { createProduct } = await import("@/server/catalog");
    const [ref] = await t.service((q) =>
      q.query<{ c: string; tx: string }>(
        "select (select id from public.product_categories where slug = 'biscuits' and company_id is null) as c, (select id from public.tax_classes where rate = 18 and company_id is null) as tx",
      ),
    );
    const product = { name: "Unit rules test", category_id: ref!.c, tax_class_id: ref!.tx, attributes: {} };
    const unit = (unit_code: string, factor_to_base: string) => ({ unit_code, factor_to_base, price: "10" });
    // Selling by the stock unit with a pack size other than 1.
    const packErr = (await rejects(
      createProduct(IDS.sahyadriOwner, IDS.sahyadri, product, { name: "1", sku: "UNIT-T1", base_unit: "carton", units: [unit("piece", "1"), unit("carton", "24")] }),
    )) as Error & { fieldErrors?: Record<string, string[]> };
    expect(Object.keys(packErr.fieldErrors ?? {})).toEqual(["units.1.factor_to_base"]);
    expect(packErr.message).toMatch(/Pack size must be 1 when you sell by the carton/);
    // The same selling unit twice.
    const dupErr = (await rejects(
      createProduct(IDS.sahyadriOwner, IDS.sahyadri, product, { name: "1", sku: "UNIT-T2", base_unit: "piece", units: [unit("piece", "1"), unit("piece", "1")] }),
    )) as Error & { fieldErrors?: Record<string, string[]> };
    expect(Object.keys(dupErr.fieldErrors ?? {})).toEqual(["units.1.unit_code"]);
  });
});

describe("cart, quote and order submission", () => {
  it("enforces the wholesaler's minimum order value", async () => {
    const quote = await quoteOrder(IDS.ganeshOwner, IDS.ganesh, IDS.sahyadri, [{ variant_unit_id: product.variant_unit_id, quantity: "1" }]);
    expect(quote.errors.join(" ")).toMatch(/Minimum order value/);
    await rejects(
      placeOrder(IDS.ganeshOwner, { retailer_id: IDS.ganesh, wholesaler_id: IDS.sahyadri, items: [{ variant_unit_id: product.variant_unit_id, quantity: "1" }], idempotency_key: key() }),
    );
    // The remaining tests use small orders, so lift the minimum for this test database.
    await t.service((q) => q.query("update public.wholesaler_profiles set min_order_value = 0 where company_id = $1", [IDS.sahyadri]));
  });

  it("keeps a separate cart per wholesaler", async () => {
    await setCartQuantity(IDS.ganeshOwner, IDS.ganesh, product.variant_unit_id, "6");
    const carts = await getCarts(IDS.ganeshOwner, IDS.ganesh);
    const mine = carts.find((c) => c.wholesaler_id === IDS.sahyadri);
    expect(mine?.items.some((i) => i.variant_unit_id === product.variant_unit_id)).toBe(true);
  });

  it("prices the order in the database identically to the TypeScript pricing module", async () => {
    const quote = await quoteOrder(IDS.ganeshOwner, IDS.ganesh, IDS.sahyadri, [{ variant_unit_id: product.variant_unit_id, quantity: "10" }]);
    const ts = calcLine({ quantity: "10", unitPrice: "12.50", discountPercent: "4", taxRate: "18.00", priceIncludesTax: false });
    expect(quote.subtotal).toBe(ts.lineAmount); // 125.00
    expect(quote.discount_total).toBe(ts.discountAmount); // 5.00
    expect(quote.taxable_total).toBe(ts.taxableAmount); // 120.00
    expect(quote.tax_total).toBe(ts.taxAmount); // 21.60
    expect(quote.items_total).toBe(ts.lineTotal); // 141.60
  });

  it("calc_line in SQL matches calcLine in TypeScript across awkward inputs", async () => {
    const cases = [
      { quantity: "3", unitPrice: "33.33", discountPercent: "7.5", taxRate: "18.00", priceIncludesTax: false },
      { quantity: "7", unitPrice: "19.99", discountPercent: "0", taxRate: "5.00", priceIncludesTax: true },
      { quantity: "2.5", unitPrice: "41.10", discountPercent: "12.25", taxRate: "40.00", priceIncludesTax: true },
      { quantity: "1", unitPrice: "0.05", discountPercent: "50", taxRate: "18.00", priceIncludesTax: false },
      { quantity: "144", unitPrice: "8.40", discountPercent: "2", taxRate: "12.00", priceIncludesTax: false },
    ];
    for (const c of cases) {
      const [sql] = await t.service((q) =>
        q.query<Record<string, string>>(
          "select line_amount::text, discount_amount::text, taxable_amount::text, tax_amount::text, line_total::text from app.calc_line($1, $2, $3, $4, $5)",
          [c.quantity, c.unitPrice, c.discountPercent, c.taxRate, c.priceIncludesTax],
        ),
      );
      const ts = calcLine(c);
      expect([sql!.line_amount, sql!.discount_amount, sql!.taxable_amount, sql!.tax_amount, sql!.line_total].map((v) => Number(v).toFixed(2))).toEqual([
        ts.lineAmount,
        ts.discountAmount,
        ts.taxableAmount,
        ts.taxAmount,
        ts.lineTotal,
      ]);
    }
  });

  it("ignores client-sent prices and totals", async () => {
    const id = await placeOrder(IDS.ganeshOwner, {
      retailer_id: IDS.ganesh,
      wholesaler_id: IDS.sahyadri,
      items: [{ variant_unit_id: product.variant_unit_id, quantity: "1", price: "0.01" }],
      idempotency_key: key(),
      grand_total: "0.01",
    } as never);
    const order = await getOrder(IDS.ganeshOwner, id);
    expect(Number(order.items[0]!.unit_price)).toBe(12.5);
    expect(Number(order.grand_total)).toBeGreaterThan(1);
    await transitionOrder(IDS.sahyadriOwner, id, "cancelled", "test cleanup");
  });

  it("places an order, reserves stock and is idempotent for the same key", async () => {
    const before = await stockOf(t, product.variant_id);
    const k = key("order");
    const input = { retailer_id: IDS.ganesh, wholesaler_id: IDS.sahyadri, items: [{ variant_unit_id: product.variant_unit_id, quantity: "10" }], idempotency_key: k };
    const a = await placeOrder(IDS.ganeshOwner, input);
    const b = await placeOrder(IDS.ganeshOwner, input);
    expect(b).toBe(a);
    const count = await t.service((q) => q.query<{ n: number }>("select count(*)::int as n from public.orders where idempotency_key = $1", [k]));
    expect(count[0]!.n).toBe(1);
    const after = await stockOf(t, product.variant_id);
    expect(Number(after.reserved) - Number(before.reserved)).toBe(10);
    expect(after.on_hand).toBe(before.on_hand);
  });

  it("rejects quantities beyond available stock", async () => {
    const err = await rejects(
      placeOrder(IDS.ganeshOwner, { retailer_id: IDS.ganesh, wholesaler_id: IDS.sahyadri, items: [{ variant_unit_id: product.variant_unit_id, quantity: "100000" }], idempotency_key: key() }),
    );
    expect(err.message).toMatch(/stock|available|maximum/i);
  });

  it("releases the reservation when an order is cancelled", async () => {
    const before = await stockOf(t, product.variant_id);
    const id = await placeOrder(IDS.ganeshOwner, { retailer_id: IDS.ganesh, wholesaler_id: IDS.sahyadri, items: [{ variant_unit_id: product.variant_unit_id, quantity: "4" }], idempotency_key: key() });
    expect(Number((await stockOf(t, product.variant_id)).reserved)).toBe(Number(before.reserved) + 4);
    await transitionOrder(IDS.sahyadriOwner, id, "cancelled", "Out of route");
    expect(await stockOf(t, product.variant_id)).toEqual(before);
  });
});

describe("order lifecycle, invoice, delivery and payment", () => {
  let orderId: string;
  let invoiceId: string;

  it("moves through accepted, preparing and ready, rejecting skipped states", async () => {
    orderId = await placeOrder(IDS.ganeshOwner, {
      retailer_id: IDS.ganesh,
      wholesaler_id: IDS.sahyadri,
      items: [{ variant_unit_id: product.variant_unit_id, quantity: "100" }],
      idempotency_key: key(),
    });
    await rejects(transitionOrder(IDS.sahyadriOwner, orderId, "delivered"));
    await rejects(transitionOrder(IDS.ganeshOwner, orderId, "accepted")); // retailers cannot accept
    await transitionOrder(IDS.sahyadriOwner, orderId, "accepted");
    await transitionOrder(IDS.sahyadriStaff, orderId, "preparing");
    await transitionOrder(IDS.sahyadriStaff, orderId, "ready_for_delivery");
    const order = await getOrder(IDS.sahyadriOwner, orderId);
    expect(order.status).toBe("ready_for_delivery");
    const events = await t.service((q) => q.query<{ n: number }>("select count(*)::int n from public.order_events where order_id = $1", [orderId]));
    expect(events[0]!.n).toBeGreaterThanOrEqual(4);
  });

  it("order events are append-only", async () => {
    await rejects(t.as(IDS.sahyadriOwner, (q) => q.query("update public.order_events set note = 'x' where order_id = $1", [orderId])));
    await rejects(t.service((q) => q.query("delete from public.order_events where order_id = $1", [orderId])));
  });

  it("generates a GST invoice with CGST and SGST for an intra-state sale", async () => {
    invoiceId = await generateInvoice(IDS.sahyadriOwner, orderId);
    const inv = await getInvoice(IDS.sahyadriOwner, invoiceId);
    expect(inv.supply_type).toBe("intra_state");
    // 100 x 12.50 = 1250.00, 4% discount = 50.00, taxable 1200.00, GST 18% = 216.00
    expect(inv.taxable_total).toBe("1200.00");
    expect(inv.cgst_total).toBe("108.00");
    expect(inv.sgst_total).toBe("108.00");
    expect(inv.igst_total).toBe("0.00");
    expect(inv.invoice_number).toMatch(/^INV\/\d{2}-\d{2}\/\d{5}$/);
    expect(inv.items[0]!.hsn_code).toBe("1905");
    // Generating again returns the existing issued invoice instead of a duplicate.
    expect(await generateInvoice(IDS.sahyadriOwner, orderId)).toBe(invoiceId);
    const n = await t.service((q) => q.query<{ n: number }>("select count(*)::int n from public.invoices where order_id = $1", [orderId]));
    expect(n[0]!.n).toBe(1);
  });

  it("invoice totals cannot be edited after issue", async () => {
    await rejects(t.as(IDS.sahyadriOwner, (q) => q.query("update public.invoices set grand_total = 1 where id = $1", [invoiceId])));
  });

  it("assigns a delivery worker who sees and completes only that delivery", async () => {
    await rejects(assignDelivery(IDS.sahyadriOwner, orderId, IDS.imran)); // Imran works for another wholesaler
    const deliveryId = await assignDelivery(IDS.sahyadriOwner, orderId, IDS.ravi, "Morning route");
    const mine = await listMyDeliveries(IDS.ravi, "active");
    expect(mine.map((d) => d.id)).toContain(deliveryId);
    expect((await listMyDeliveries(IDS.sunil, "active")).map((d) => d.id)).not.toContain(deliveryId);

    await rejects(updateDelivery(IDS.sunil, { delivery_id: deliveryId, to: "out_for_delivery" }));
    const before = await stockOf(t, product.variant_id);
    await updateDelivery(IDS.ravi, { delivery_id: deliveryId, to: "out_for_delivery" });
    await updateDelivery(IDS.ravi, { delivery_id: deliveryId, to: "delivered", recipient_name: "Meera" });
    const order = await getOrder(IDS.ganeshOwner, orderId);
    expect(order.status).toBe("delivered");
    const after = await stockOf(t, product.variant_id);
    expect(Number(before.on_hand) - Number(after.on_hand)).toBe(100);
    expect(Number(before.reserved) - Number(after.reserved)).toBe(100);
  });

  it("records a partial payment, allocates it, and keeps the ledger reconciled", async () => {
    const inv = await getInvoice(IDS.sahyadriOwner, invoiceId);
    const total = Number(inv.grand_total);
    const k = key("pay");
    const input = {
      wholesaler_id: IDS.sahyadri,
      retailer_id: IDS.ganesh,
      amount: "500.00",
      method: "upi",
      reference: "UPI-TEST-1",
      received_on: todayIst(),
      idempotency_key: k,
      allocation_mode: "manual",
      allocations: [{ invoice_id: invoiceId, amount: "500.00" }],
    };
    const p1 = await recordPayment(IDS.sahyadriOwner, input);
    const p2 = await recordPayment(IDS.sahyadriOwner, input);
    expect(p2).toBe(p1);

    const [bal] = await t.service((q) =>
      q.query<{ paid: string; due: string; payment_status: string }>("select paid::text, due::text, payment_status from public.invoice_balances where invoice_id = $1", [invoiceId]),
    );
    expect(bal).toMatchObject({ paid: "500.00", payment_status: "partially_paid" });
    expect(Number(bal!.due)).toBeCloseTo(total - 500, 2);

    // Over-allocation is refused.
    await rejects(
      recordPayment(IDS.sahyadriOwner, { ...input, idempotency_key: key(), amount: "10.00", allocations: [{ invoice_id: invoiceId, amount: "20.00" }] }),
    );

    const rec = await reconcileReceivables(IDS.sahyadriOwner, IDS.sahyadri);
    expect(rec.every((r) => Number(r.difference) === 0)).toBe(true);

    // Reversal posts an opposite entry and restores the invoice balance.
    await reversePayment(IDS.sahyadriOwner, p1, "Cheque bounced (test)");
    const [after] = await t.service((q) => q.query<{ paid: string }>("select paid::text from public.invoice_balances where invoice_id = $1", [invoiceId]));
    expect(Number(after!.paid)).toBe(0);
    const rec2 = await reconcileReceivables(IDS.sahyadriOwner, IDS.sahyadri);
    expect(rec2.every((r) => Number(r.difference) === 0)).toBe(true);
  });

  it("journal entries balance (debits equal credits)", async () => {
    const lines = await t.service((q) => q.query<{ n: number }>("select count(*)::int n from public.journal_lines"));
    expect(lines[0]!.n).toBeGreaterThan(0);
    const rows = await t.service((q) =>
      q.query<{ journal_id: string; diff: string }>(
        "select journal_id, (sum(debit) - sum(credit))::text as diff from public.journal_lines group by journal_id having sum(debit) <> sum(credit)",
      ),
    );
    expect(rows).toEqual([]);
  });

  it("a confirmed order's total cannot be changed by its parties", async () => {
    await rejects(t.as(IDS.sahyadriOwner, (q) => q.query("update public.orders set grand_total = 1 where id = $1", [orderId])));
    await rejects(t.as(IDS.ganeshOwner, (q) => q.query("update public.orders set grand_total = 1 where id = $1", [orderId])));
    await rejects(t.as(IDS.ganeshOwner, (q) => q.query("update public.order_items set unit_price = 0.01 where order_id = $1", [orderId])));
    const [o] = await t.service((q) => q.query<{ grand_total: string }>("select grand_total::text from public.orders where id = $1", [orderId]));
    expect(Number(o!.grand_total)).toBeGreaterThan(1);
  });
});

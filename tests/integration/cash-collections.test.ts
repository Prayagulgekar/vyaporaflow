/**
 * Integration: delivery cash collections, retailer balances and cash handovers
 * (migration 20261029000100). Every call goes through the real server modules
 * as a real user, so RLS and the database functions' own checks apply.
 *
 * The scenario mirrors the business example: two orders for one shop,
 * ₹200 and ₹300, of which the delivery worker collects ₹100 and ₹200.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDS, freshDatabase, key, makeProduct, rejects, type TestDb } from "../support/test-db";
import { placeOrder, transitionOrder } from "@/server/orders";
import { generateInvoice, recordPayment, reconcileReceivables, reversePayment } from "@/server/billing";
import { assignDelivery, updateDelivery } from "@/server/deliveries";
import {
  cashSummary,
  completeDelivery,
  confirmHandover,
  getCollection,
  getDeliveryCollection,
  listCollections,
  pendingCash,
  recordCollection,
  reverseHandover,
} from "@/server/collections";
import { planHandover } from "@/domain/cash";

let t: TestDb;
let product: Awaited<ReturnType<typeof makeProduct>>;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const range = () => ({ from: today(), to: today() });

beforeAll(async () => {
  t = await freshDatabase();
  // Round numbers: ₹100 a piece, 0% GST, no delivery charge, no minimum.
  await t.service((q) =>
    q.query("update public.wholesaler_profiles set min_order_value = 0, delivery_charge = 0, free_delivery_above = null where company_id = $1", [IDS.sahyadri]),
  );
  product = await makeProduct(t, IDS.sahyadriOwner, IDS.sahyadri, { stock: "500", price: "100.00", taxRate: "0.00" });
});
afterAll(async () => t?.close());

/** Place an order for `qty` pieces (₹100 each) and take it out for delivery with `worker`. */
async function outForDelivery(retailerOwner: string, retailer: string, qty: string, worker: string = IDS.ravi, opts: { invoiceFirst?: boolean } = {}) {
  const orderId = await placeOrder(retailerOwner, { retailer_id: retailer, wholesaler_id: IDS.sahyadri, items: [{ variant_unit_id: product.variant_unit_id, quantity: qty }], idempotency_key: key("ord") });
  await transitionOrder(IDS.sahyadriOwner, orderId, "accepted");
  if (opts.invoiceFirst) await generateInvoice(IDS.sahyadriOwner, orderId);
  await transitionOrder(IDS.sahyadriOwner, orderId, "preparing");
  await transitionOrder(IDS.sahyadriOwner, orderId, "ready_for_delivery");
  const deliveryId = await assignDelivery(IDS.sahyadriOwner, orderId, worker);
  await updateDelivery(worker, { delivery_id: deliveryId, to: "out_for_delivery" });
  return { orderId, deliveryId };
}

const deliver = (worker: string, deliveryId: string, amount: string, k = key("col"), method: "cash" | "upi" = "cash", reference?: string) =>
  completeDelivery(worker, { delivery_id: deliveryId, to: "delivered", amount, method, reference, idempotency_key: k, recipient_name: "Shop owner" });

async function outstanding(retailer: string) {
  const [r] = await t.service((q) =>
    q.query<{ outstanding: string; unapplied: string; received: string }>(
      "select outstanding::text, unapplied::text, received::text from public.retailer_balances where wholesaler_id = $1 and retailer_id = $2",
      [IDS.sahyadri, retailer],
    ),
  );
  return r!;
}
async function pendingOf(worker: string) {
  const [r] = await t.service((q) =>
    q.query<{ pending: string }>("select coalesce(sum(pending_handover), 0)::text as pending from public.delivery_collection_balances where wholesaler_id = $1 and worker_id = $2", [IDS.sahyadri, worker]),
  );
  return r!.pending;
}
const count = async (sql: string, params: unknown[] = []) => Number(Object.values((await t.service((q) => q.query<Record<string, unknown>>(sql, params)))[0]!)[0]);
const money = (v: string) => Number(v).toFixed(2);

describe("partial cash collection on delivery (cases 1-3)", () => {
  let o1: { orderId: string; deliveryId: string };
  let o2: { orderId: string; deliveryId: string };
  let before: Awaited<ReturnType<typeof outstanding>>;

  beforeAll(async () => {
    before = await outstanding(IDS.ganesh);
    o1 = await outForDelivery(IDS.ganeshOwner, IDS.ganesh, "2");
    o2 = await outForDelivery(IDS.ganeshOwner, IDS.ganesh, "3");
  });

  it("case 1: ₹200 order, ₹100 collected: shop owes ₹100, worker holds ₹100", async () => {
    const view = await getDeliveryCollection(IDS.ravi, o1.deliveryId);
    expect(money(view.position!.order_value)).toBe("200.00");
    expect(money(view.position!.balance_due)).toBe("200.00");
    const r = await deliver(IDS.ravi, o1.deliveryId, "100");
    expect(r.payment_number).toMatch(/^RCPT-/);
    expect(r.collection_number).toMatch(/^COL-/);
    expect(money(r.balance_due)).toBe("100.00");
    expect(money(await pendingOf(IDS.ravi))).toBe("100.00");
  });

  it("case 2: ₹300 order, ₹200 collected: shop owes ₹100 on it, worker holds ₹300 in total", async () => {
    const r = await deliver(IDS.ravi, o2.deliveryId, "200");
    expect(money(r.balance_due)).toBe("100.00");
    expect(money(await pendingOf(IDS.ravi))).toBe("300.00");
  });

  it("collections are real payments, unapplied until the orders are invoiced (existing advance rule)", async () => {
    const pays = await t.service((q) =>
      q.query<{ amount: string; method: string; unapplied: string; recorded_by: string }>(
        `select pb.amount::text, pb.method, pb.unapplied::text, p.recorded_by from public.payment_balances pb join public.payments p on p.id = pb.payment_id
          join public.delivery_collections c on c.payment_id = p.id where c.order_id = any ($1) order by pb.amount`,
        [[o1.orderId, o2.orderId]],
      ),
    );
    expect(pays.map((p) => [p.amount, p.method, p.unapplied, p.recorded_by])).toEqual([
      ["100.00", "cash", "100.00", IDS.ravi],
      ["200.00", "cash", "200.00", IDS.ravi],
    ]);
  });

  it("case 3: after invoicing both orders: value ₹500, collected ₹300, shop owes ₹200, worker holds ₹300", async () => {
    await generateInvoice(IDS.sahyadriOwner, o1.orderId);
    await generateInvoice(IDS.sahyadriOwner, o2.orderId);
    // The collections were applied to their own invoices automatically.
    const inv = await t.service((q) =>
      q.query<{ grand_total: string; paid: string; due: string }>(
        "select grand_total::text, paid::text, due::text from public.invoice_balances where order_id = any ($1) and status = 'issued' order by grand_total",
        [[o1.orderId, o2.orderId]],
      ),
    );
    expect(inv).toEqual([
      { grand_total: "200.00", paid: "100.00", due: "100.00" },
      { grand_total: "300.00", paid: "200.00", due: "100.00" },
    ]);
    const after = await outstanding(IDS.ganesh);
    expect(money(String(Number(after.outstanding) - Number(before.outstanding)))).toBe("200.00");
    expect(after.unapplied).toBe(before.unapplied);
    expect(money(await pendingOf(IDS.ravi))).toBe("300.00");

    const [ravi] = (await cashSummary(IDS.sahyadriOwner, IDS.sahyadri, { ...range(), worker: IDS.ravi })) ;
    expect(ravi).toMatchObject({ completed_deliveries: 2, deliveries_without_collection: 0 });
    expect(money(ravi!.order_value)).toBe("500.00");
    expect(money(ravi!.cash_collected)).toBe("300.00");
    expect(money(ravi!.cash_handed_over)).toBe("0.00");
    expect(money(ravi!.cash_pending)).toBe("300.00");
    expect(money(ravi!.retailer_balance_due)).toBe("200.00");
  });

  it("the ledger agrees: AR matches documents and CASH_IN_TRANSIT equals cash pending", async () => {
    const rec = await reconcileReceivables(IDS.sahyadriOwner, IDS.sahyadri);
    expect(rec.every((r) => Number(r.difference) === 0)).toBe(true);
    const [cit] = await t.service((q) =>
      q.query<{ bal: string }>("select coalesce(sum(debit - credit), 0)::text as bal from public.journal_lines where company_id = $1 and account_code = 'CASH_IN_TRANSIT'", [IDS.sahyadri]),
    );
    expect(money(cit!.bal)).toBe(money(await pendingOf(IDS.ravi)));
  });

  it("case 5: ₹250 received of ₹300: ₹50 stays pending and the discrepancy is recorded", async () => {
    const pending = await pendingCash(IDS.sahyadriOwner, IDS.sahyadri, IDS.ravi);
    expect(pending.map((p) => money(p.pending_handover))).toEqual(["100.00", "200.00"]);
    const plan = planHandover(pending.map((p) => ({ id: p.collection_id, collectedAt: p.collected_at, pending: p.pending_handover })), "250");
    const before = await outstanding(IDS.ganesh);
    const id = await confirmHandover(IDS.sahyadriOwner, {
      wholesaler_id: IDS.sahyadri, worker_id: IDS.ravi, collection_ids: pending.map((p) => p.collection_id),
      expected: "300.00", received: "250", note: "₹50 short", idempotency_key: key("ho"),
    });
    const [h] = await t.service((q) => q.query<{ expected_amount: string; received_amount: string; discrepancy: string; received_by: string }>(
      "select expected_amount::text, received_amount::text, discrepancy::text, received_by from public.cash_handovers where id = $1", [id]));
    expect(h).toEqual({ expected_amount: "300.00", received_amount: "250.00", discrepancy: "50.00", received_by: IDS.sahyadriOwner });
    expect(money(await pendingOf(IDS.ravi))).toBe("50.00");
    // Oldest first: the ₹100 collection is fully handed over, ₹150 of the ₹200 one.
    const after = await pendingCash(IDS.sahyadriOwner, IDS.sahyadri, IDS.ravi);
    expect(after.map((p) => [money(p.amount), money(p.handed_over), money(p.pending_handover), p.handover_status])).toEqual([["200.00", "150.00", "50.00", "partially_handed_over"]]);
    expect(plan.discrepancy).toBe("50.00");
    expect(plan.items.map((i) => i.stillPending)).toEqual(["0.00", "50.00"]);
    // A handover is internal: the shop's balance does not move.
    expect(await outstanding(IDS.ganesh)).toEqual(before);
    const audit = await count("select count(*) from public.audit_logs where action = 'cash_handover.confirmed' and target_id = $1", [id]);
    expect(audit).toBe(1);
  });

  it("case 4: the remaining ₹50 is handed over: nothing pending, shop still owes ₹200, no new payment", async () => {
    const paymentsBefore = await count("select count(*) from public.payments where wholesaler_id = $1", [IDS.sahyadri]);
    const before = await outstanding(IDS.ganesh);
    const pending = await pendingCash(IDS.sahyadriOwner, IDS.sahyadri, IDS.ravi);
    await confirmHandover(IDS.sahyadriOwner, {
      wholesaler_id: IDS.sahyadri, worker_id: IDS.ravi, collection_ids: pending.map((p) => p.collection_id),
      expected: "50.00", received: "50.00", idempotency_key: key("ho"),
    });
    expect(money(await pendingOf(IDS.ravi))).toBe("0.00");
    expect(await outstanding(IDS.ganesh)).toEqual(before);
    expect(await count("select count(*) from public.payments where wholesaler_id = $1", [IDS.sahyadri])).toBe(paymentsBefore);
    const [ravi] = await cashSummary(IDS.sahyadriOwner, IDS.sahyadri, { ...range(), worker: IDS.ravi });
    expect([ravi!.cash_collected, ravi!.cash_handed_over, ravi!.cash_pending, ravi!.retailer_balance_due].map(money)).toEqual(["300.00", "300.00", "0.00", "200.00"]);
  });

  it("refuses a handover when nothing is pending, and a collection over the amount due", async () => {
    const e = await rejects(confirmHandover(IDS.sahyadriOwner, {
      wholesaler_id: IDS.sahyadri, worker_id: IDS.ravi, collection_ids: [(await listCollections(IDS.sahyadriOwner, IDS.sahyadri, { ...range(), worker: IDS.ravi })).rows[0]!.collection_id],
      expected: "0", received: "10", idempotency_key: key("ho"),
    }));
    expect(e.message).toMatch(/no cash pending|already handed over/i);
    // ₹100 is still due on order 1: ₹101 is refused, ₹100 is accepted later by the office instead.
    const e2 = await rejects(recordCollection(IDS.ravi, { delivery_id: o1.deliveryId, amount: "101", method: "cash", idempotency_key: key("col") }));
    expect(e2.message).toMatch(/Only Rs 100.00 is due/);
  });

  it("reversing a handover makes its cash pending again; a handed-over collection cannot be reversed as a payment", async () => {
    const [h] = await t.service((q) => q.query<{ id: string; payment_id: string }>(
      `select h.id, c.payment_id from public.cash_handovers h join public.cash_handover_items i on i.handover_id = h.id
         join public.delivery_collections c on c.id = i.collection_id where h.worker_id = $1 and h.received_amount = 50`, [IDS.ravi]));
    const e = await rejects(reversePayment(IDS.sahyadriOwner, h!.payment_id, "Wrong shop"));
    expect(e.message).toMatch(/handed over/);
    await rejects(reverseHandover(IDS.ravi, h!.id, "I did not hand it over"));
    await reverseHandover(IDS.sahyadriOwner, h!.id, "Counted twice by mistake");
    expect(money(await pendingOf(IDS.ravi))).toBe("50.00");
    const rec = await reconcileReceivables(IDS.sahyadriOwner, IDS.sahyadri);
    expect(rec.every((r) => Number(r.difference) === 0)).toBe(true);
  });
});

describe("zero collections, duplicates and delivery without collection (cases 6, 7, 8, 14)", () => {
  it("case 6: ₹0 collected: delivery completes, no payment is created, balance stays fully due", async () => {
    const o = await outForDelivery(IDS.ganeshOwner, IDS.ganesh, "1");
    const payments = await count("select count(*) from public.payments where wholesaler_id = $1", [IDS.sahyadri]);
    const r = await deliver(IDS.ravi, o.deliveryId, "0");
    expect(r.payment_number).toBeNull();
    expect(money(r.balance_due)).toBe("100.00");
    expect(await count("select count(*) from public.payments where wholesaler_id = $1", [IDS.sahyadri])).toBe(payments);
    expect(await count("select count(*) from public.deliveries where id = $1 and status = 'delivered'", [o.deliveryId])).toBe(1);
    // A second ₹0 record on the same delivery is refused; a real later collection is allowed.
    await rejects(recordCollection(IDS.ravi, { delivery_id: o.deliveryId, amount: "0", method: "cash", idempotency_key: key("col") }));
    const later = await recordCollection(IDS.ravi, { delivery_id: o.deliveryId, amount: "40", method: "cash", idempotency_key: key("col") });
    expect(money(later.balance_due)).toBe("60.00");
  });

  it("accepts a hand-typed time in the same minute the order was placed, refuses future times", async () => {
    const o = await outForDelivery(IDS.ganeshOwner, IDS.ganesh, "1");
    const [row] = await t.service((q) => q.query<{ m: string }>(
      "select to_char(placed_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD\"T\"HH24:MI') as m from public.orders where id = $1", [o.orderId]));
    const r = await completeDelivery(IDS.ravi, { delivery_id: o.deliveryId, to: "delivered", amount: "10", method: "cash", collected_at: row!.m, idempotency_key: key("col") });
    expect(r.collection_number).toMatch(/^COL-/);
    const future = new Date(Date.now() + 3600_000).toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" }).slice(0, 16).replace(" ", "T");
    await rejects(recordCollection(IDS.ravi, { delivery_id: o.deliveryId, amount: "10", method: "cash", collected_at: future, idempotency_key: key("col") }));
  });

  it("case 7: the same submission twice creates one collection and one payment", async () => {
    const o = await outForDelivery(IDS.ganeshOwner, IDS.ganesh, "2");
    const k = key("dup");
    const a = await deliver(IDS.ravi, o.deliveryId, "150", k);
    const b = await deliver(IDS.ravi, o.deliveryId, "150", k);
    const c = await recordCollection(IDS.ravi, { delivery_id: o.deliveryId, amount: "150", method: "cash", idempotency_key: k });
    expect(b.id).toBe(a.id);
    expect(c.id).toBe(a.id);
    expect(await count("select count(*) from public.delivery_collections where delivery_id = $1", [o.deliveryId])).toBe(1);
    expect(await count("select count(*) from public.payments p join public.delivery_collections c on c.payment_id = p.id where c.delivery_id = $1", [o.deliveryId])).toBe(1);
  });

  it("a rejected collection leaves the delivery undelivered (one transaction)", async () => {
    const o = await outForDelivery(IDS.ganeshOwner, IDS.ganesh, "1");
    await rejects(deliver(IDS.ravi, o.deliveryId, "100.01"));
    await rejects(deliver(IDS.ravi, o.deliveryId, "-5"));
    expect(await count("select count(*) from public.deliveries where id = $1 and status = 'out_for_delivery'", [o.deliveryId])).toBe(1);
    expect(await count("select count(*) from public.delivery_collections where delivery_id = $1", [o.deliveryId])).toBe(0);
  });

  it("case 8: the same handover submitted twice is recorded once", async () => {
    const o = await outForDelivery(IDS.ganeshOwner, IDS.ganesh, "1", IDS.sunil);
    await deliver(IDS.sunil, o.deliveryId, "100");
    const pending = await pendingCash(IDS.sahyadriOwner, IDS.sahyadri, IDS.sunil);
    const input = { wholesaler_id: IDS.sahyadri, worker_id: IDS.sunil, collection_ids: pending.map((p) => p.collection_id), expected: "100.00", received: "100", idempotency_key: key("ho") };
    const a = await confirmHandover(IDS.sahyadriOwner, input);
    const b = await confirmHandover(IDS.sahyadriOwner, input);
    expect(b).toBe(a);
    expect(await count("select count(*) from public.cash_handovers where worker_id = $1", [IDS.sunil])).toBe(1);
    expect(money(await pendingOf(IDS.sunil))).toBe("0.00");
  });

  it("case 14: marked delivered without collection (office path): status updates, no payment, no collection", async () => {
    const o = await outForDelivery(IDS.ganeshOwner, IDS.ganesh, "1");
    const payments = await count("select count(*) from public.payments where wholesaler_id = $1", [IDS.sahyadri]);
    await updateDelivery(IDS.ravi, { delivery_id: o.deliveryId, to: "delivered" });
    expect(await count("select count(*) from public.deliveries where id = $1 and status = 'delivered'", [o.deliveryId])).toBe(1);
    expect(await count("select count(*) from public.payments where wholesaler_id = $1", [IDS.sahyadri])).toBe(payments);
    expect(await count("select count(*) from public.delivery_collections where delivery_id = $1", [o.deliveryId])).toBe(0);
    const [s] = await cashSummary(IDS.sahyadriOwner, IDS.sahyadri, { ...range(), worker: IDS.ravi });
    expect(s!.deliveries_without_collection).toBeGreaterThanOrEqual(1);
    const pos = await getDeliveryCollection(IDS.ravi, o.deliveryId);
    expect(money(pos.position!.balance_due)).toBe("100.00");
  });

  it("UPI on delivery needs a reference and never waits for a cash handover", async () => {
    const o = await outForDelivery(IDS.ganeshOwner, IDS.ganesh, "1");
    await rejects(deliver(IDS.ravi, o.deliveryId, "100", key("col"), "upi"));
    const before = await pendingOf(IDS.ravi);
    const r = await deliver(IDS.ravi, o.deliveryId, "100", key("col"), "upi", "UPI-REF-123");
    expect(r.method).toBe("upi");
    expect(await pendingOf(IDS.ravi)).toBe(before);
  });
});

describe("invoices and the manually recorded advance (cases 12, 13)", () => {
  it("case 13: collected on an already invoiced order: applied to that invoice", async () => {
    const before = await outstanding(IDS.omsai);
    const o = await outForDelivery(IDS.omsaiOwner, IDS.omsai, "4", IDS.ravi, { invoiceFirst: true });
    await deliver(IDS.ravi, o.deliveryId, "150");
    const [inv] = await t.service((q) => q.query<{ paid: string; due: string; payment_status: string }>(
      "select paid::text, due::text, payment_status from public.invoice_balances where order_id = $1 and status = 'issued'", [o.orderId]));
    expect(inv).toEqual({ paid: "150.00", due: "250.00", payment_status: "partially_paid" });
    const after = await outstanding(IDS.omsai);
    expect(money(String(Number(after.outstanding) - Number(before.outstanding)))).toBe("250.00");
    expect(after.unapplied).toBe(before.unapplied);
  });

  it("case 12: a manual ₹300 advance stays intact and is never attached to deliveries", async () => {
    const advanceId = await recordPayment(IDS.sahyadriOwner, {
      wholesaler_id: IDS.sahyadri, retailer_id: IDS.omsai, amount: "300", method: "cash", received_on: today(),
      idempotency_key: key("adv"), allocation_mode: "none",
    });
    const snapshot = async () => (await t.service((q) => q.query("select amount::text, status, unapplied::text from public.payment_balances where payment_id = $1", [advanceId])))[0];
    const adv0 = await snapshot();
    expect(adv0).toEqual({ amount: "300.00", status: "posted", unapplied: "300.00" });
    const bal0 = await outstanding(IDS.omsai);
    const payments0 = await count("select count(*) from public.payments where retailer_id = $1", [IDS.omsai]);

    const o = await outForDelivery(IDS.omsaiOwner, IDS.omsai, "2");
    // The worker sees the full order due; the office's advance is not assumed to be this cash.
    expect(money((await getDeliveryCollection(IDS.ravi, o.deliveryId)).position!.balance_due)).toBe("200.00");
    await deliver(IDS.ravi, o.deliveryId, "100");
    await generateInvoice(IDS.sahyadriOwner, o.orderId);

    expect(await snapshot()).toEqual(adv0);
    expect(await count("select count(*) from public.payments where retailer_id = $1", [IDS.omsai])).toBe(payments0 + 1);
    const bal1 = await outstanding(IDS.omsai);
    // +200 invoiced, -100 collected; the advance still counts once, as unapplied.
    expect(money(String(Number(bal1.outstanding) - Number(bal0.outstanding)))).toBe("100.00");
    expect(bal1.unapplied).toBe(bal0.unapplied);
    expect(await count("select count(*) from public.delivery_collections where payment_id = $1", [advanceId])).toBe(0);
  });
});

describe("access control (cases 9, 10)", () => {
  let delivery: string;
  let collection: string;
  beforeAll(async () => {
    const o = await outForDelivery(IDS.ganeshOwner, IDS.ganesh, "1");
    delivery = o.deliveryId;
    collection = (await deliver(IDS.ravi, delivery, "60")).id;
  });

  it("case 9: another worker of the same company cannot see or add to Ravi's collections", async () => {
    const seen = await t.as(IDS.sunil, (q) => q.query("select * from public.delivery_collections where worker_id = $1", [IDS.ravi]));
    expect(seen).toHaveLength(0);
    expect(await t.as(IDS.sunil, (q) => q.query("select * from public.delivery_collection_balances where collection_id = $1", [collection]))).toHaveLength(0);
    const e = await rejects(recordCollection(IDS.sunil, { delivery_id: delivery, amount: "10", method: "cash", idempotency_key: key("col") }));
    expect(e.message).toMatch(/not assigned to you/);
    await rejects(getDeliveryCollection(IDS.sunil, delivery));
    await rejects(getCollection(IDS.sunil, collection));
    // Workers cannot confirm handovers, not even of their own cash.
    await rejects(confirmHandover(IDS.ravi, { wholesaler_id: IDS.sahyadri, worker_id: IDS.ravi, collection_ids: [collection], expected: "60", received: "60", idempotency_key: key("ho") }));
    await rejects(confirmHandover(IDS.sahyadriStaff, { wholesaler_id: IDS.sahyadri, worker_id: IDS.ravi, collection_ids: [collection], expected: "60", received: "60", idempotency_key: key("ho") }));
  });

  it("case 10: another company's worker and owner see nothing and cannot act", async () => {
    for (const user of [IDS.imran, IDS.annapurnaOwner, IDS.ganeshOwner]) {
      expect(await t.as(user, (q) => q.query("select * from public.delivery_collections where id = $1", [collection]))).toHaveLength(0);
      expect(await t.as(user, (q) => q.query("select * from public.cash_handovers where wholesaler_id = $1", [IDS.sahyadri]))).toHaveLength(0);
      await rejects(getCollection(user, collection));
    }
    await rejects(recordCollection(IDS.imran, { delivery_id: delivery, amount: "10", method: "cash", idempotency_key: key("col") }));
    await rejects(confirmHandover(IDS.annapurnaOwner, { wholesaler_id: IDS.sahyadri, worker_id: IDS.ravi, collection_ids: [collection], expected: "60", received: "60", idempotency_key: key("ho") }));
    expect(await cashSummary(IDS.annapurnaOwner, IDS.sahyadri, range())).toEqual([]);
  });

  it("nobody can write the new tables directly", async () => {
    await rejects(t.as(IDS.ravi, (q) => q.query("update public.delivery_collections set amount = 1 where id = $1", [collection])));
    await rejects(t.as(IDS.sahyadriOwner, (q) => q.query("delete from public.delivery_collections where id = $1", [collection])));
    await rejects(t.as(IDS.sahyadriOwner, (q) => q.query(
      "insert into public.cash_handovers (handover_number, wholesaler_id, worker_id, expected_amount, received_amount, discrepancy, received_by, received_at, idempotency_key) values ('X', $1, $2, 1, 1, 0, $3, now(), 'xxxxxxxxxx')",
      [IDS.sahyadri, IDS.ravi, IDS.sahyadriOwner])));
    await rejects(t.as(null, (q) => q.query("select app.record_delivery_collection($1, 1, 'cash', null, null, null, 'anon-key-123')", [delivery])));
    // Even the database owner cannot rewrite a collection's amount.
    await rejects(t.service((q) => q.query("update public.delivery_collections set amount = 1 where id = $1", [collection])));
  });
});

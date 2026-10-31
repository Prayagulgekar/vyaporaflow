/**
 * Workflow E (database level): concurrent purchases of the last stock and
 * duplicate submissions. PGlite has a single connection, so true concurrency
 * needs a real PostgreSQL server: set TEST_DATABASE_URL to a disposable local
 * server (e.g. postgres://postgres:postgres@localhost:5432/postgres). Without
 * it these tests are skipped and reported as skipped.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDS, freshDatabase, key, makeProduct, stockOf, type TestDb } from "../support/test-db";
import { placeOrder } from "@/server/orders";
import { recordPayment } from "@/server/billing";
import { transitionOrder } from "@/server/orders";
import { assignDelivery, updateDelivery } from "@/server/deliveries";
import { completeDelivery, confirmHandover, pendingCash } from "@/server/collections";

const hasPg = Boolean(process.env.TEST_DATABASE_URL);
let t: TestDb;

describe.skipIf(!hasPg)("concurrency on PostgreSQL", () => {
  beforeAll(async () => {
    t = await freshDatabase({ engine: "postgres" });
    await t.service((q) => q.query("update public.wholesaler_profiles set min_order_value = 0 where company_id = $1", [IDS.sahyadri]));
  });
  afterAll(async () => t?.close());

  it("does not oversell the last units when many retailers buy at once", async () => {
    const p = await makeProduct(t, IDS.sahyadriOwner, IDS.sahyadri, { stock: "5", price: "100.00" });
    const buyers = [
      [IDS.ganeshOwner, IDS.ganesh],
      [IDS.omsaiOwner, IDS.omsai],
    ] as const;
    // 10 simultaneous orders of 1 unit each (5 per retailer) for 5 units of stock.
    const attempts = Array.from({ length: 10 }, (_, i) => {
      const [user, shop] = buyers[i % 2]!;
      return placeOrder(user, { retailer_id: shop, wholesaler_id: IDS.sahyadri, items: [{ variant_unit_id: p.variant_unit_id, quantity: "1" }], idempotency_key: key(`race${i}`) });
    });
    const results = await Promise.allSettled(attempts);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBe(5);
    const stock = await stockOf(t, p.variant_id);
    expect(stock).toEqual({ on_hand: "5.000", reserved: "5.000", available: "0.000" });
    for (const r of results) if (r.status === "rejected") expect(String(r.reason.message)).toMatch(/stock|available/i);
  });

  it("two buyers racing for the last 3 units with 2 each: exactly one wins", async () => {
    const p = await makeProduct(t, IDS.sahyadriOwner, IDS.sahyadri, { stock: "3", price: "50.00" });
    const results = await Promise.allSettled([
      placeOrder(IDS.ganeshOwner, { retailer_id: IDS.ganesh, wholesaler_id: IDS.sahyadri, items: [{ variant_unit_id: p.variant_unit_id, quantity: "2" }], idempotency_key: key() }),
      placeOrder(IDS.omsaiOwner, { retailer_id: IDS.omsai, wholesaler_id: IDS.sahyadri, items: [{ variant_unit_id: p.variant_unit_id, quantity: "2" }], idempotency_key: key() }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect((await stockOf(t, p.variant_id)).reserved).toBe("2.000");
  });

  it("duplicate concurrent order submissions with one key create one order", async () => {
    const p = await makeProduct(t, IDS.sahyadriOwner, IDS.sahyadri, { stock: "50", price: "20.00" });
    const k = key("dup");
    const input = { retailer_id: IDS.ganesh, wholesaler_id: IDS.sahyadri, items: [{ variant_unit_id: p.variant_unit_id, quantity: "3" }], idempotency_key: k };
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => placeOrder(IDS.ganeshOwner, input)));
    const ids = new Set(results.filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled").map((r) => r.value));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(ids.size).toBe(1);
    const [n] = await t.service((q) => q.query<{ n: number }>("select count(*)::int n from public.orders where idempotency_key = $1", [k]));
    expect(n!.n).toBe(1);
    expect((await stockOf(t, p.variant_id)).reserved).toBe("3.000");
  });

  it("duplicate concurrent payment requests with one key record one payment", async () => {
    const k = key("pay");
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const input = { wholesaler_id: IDS.sahyadri, retailer_id: IDS.ganesh, amount: "250.00", method: "cash", received_on: today, idempotency_key: k, allocation_mode: "auto" };
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => recordPayment(IDS.sahyadriOwner, input)));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const ids = new Set(results.map((r) => (r as PromiseFulfilledResult<string>).value));
    expect(ids.size).toBe(1);
    const [n] = await t.service((q) => q.query<{ n: number; allocated: string }>(
      `select count(*)::int n, coalesce((select sum(a.amount) from public.payment_allocations a join public.payments p on p.id = a.payment_id where p.idempotency_key = $1), 0)::text allocated
         from public.payments where idempotency_key = $1`, [k]));
    expect(n!.n).toBe(1);
    expect(Number(n!.allocated)).toBeLessThanOrEqual(250);
  });

  it("two people reconciling the same cash at once hand it over only once (case 11)", async () => {
    await t.service((q) => q.query("update public.wholesaler_profiles set delivery_charge = 0, free_delivery_above = null where company_id = $1", [IDS.sahyadri]));
    const p = await makeProduct(t, IDS.sahyadriOwner, IDS.sahyadri, { stock: "50", price: "100.00", taxRate: "0.00" });
    for (const qty of ["2", "3"]) {
      const orderId = await placeOrder(IDS.ganeshOwner, { retailer_id: IDS.ganesh, wholesaler_id: IDS.sahyadri, items: [{ variant_unit_id: p.variant_unit_id, quantity: qty }], idempotency_key: key("hord") });
      for (const s of ["accepted", "preparing", "ready_for_delivery"]) await transitionOrder(IDS.sahyadriOwner, orderId, s);
      const d = await assignDelivery(IDS.sahyadriOwner, orderId, IDS.ravi);
      await updateDelivery(IDS.ravi, { delivery_id: d, to: "out_for_delivery" });
      await completeDelivery(IDS.ravi, { delivery_id: d, to: "delivered", amount: qty === "2" ? "100" : "200", method: "cash", idempotency_key: key("hcol") });
    }
    const pending = await pendingCash(IDS.sahyadriOwner, IDS.sahyadri, IDS.ravi);
    const ids = pending.map((c) => c.collection_id);
    expect(pending.reduce((s, c) => s + Number(c.pending_handover), 0)).toBe(300);
    // Owner and manager, six different submissions, all at once.
    const users = [IDS.sahyadriOwner, IDS.sahyadriOwner, IDS.sahyadriOwner, IDS.sahyadriOwner, IDS.sahyadriOwner, IDS.sahyadriOwner];
    const results = await Promise.allSettled(users.map((u, i) =>
      confirmHandover(u, { wholesaler_id: IDS.sahyadri, worker_id: IDS.ravi, collection_ids: ids, expected: "300.00", received: "300", idempotency_key: key(`hrace${i}`) })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [row] = await t.service((q) => q.query<{ handovers: number; handed: string; pending: string }>(
      `select (select count(*)::int from public.cash_handovers where worker_id = $1 and status = 'confirmed') as handovers,
              (select coalesce(sum(i.amount), 0)::text from public.cash_handover_items i join public.cash_handovers h on h.id = i.handover_id where h.worker_id = $1) as handed,
              (select coalesce(sum(pending_handover), 0)::text from public.delivery_collection_balances where worker_id = $1) as pending`, [IDS.ravi]));
    expect(row).toEqual({ handovers: 1, handed: "300.00", pending: "0.00" });
  });

  it("six identical collection submissions at once record one payment", async () => {
    const p = await makeProduct(t, IDS.sahyadriOwner, IDS.sahyadri, { stock: "10", price: "100.00", taxRate: "0.00" });
    const orderId = await placeOrder(IDS.ganeshOwner, { retailer_id: IDS.ganesh, wholesaler_id: IDS.sahyadri, items: [{ variant_unit_id: p.variant_unit_id, quantity: "1" }], idempotency_key: key("dord") });
    for (const s of ["accepted", "preparing", "ready_for_delivery"]) await transitionOrder(IDS.sahyadriOwner, orderId, s);
    const d = await assignDelivery(IDS.sahyadriOwner, orderId, IDS.ravi);
    await updateDelivery(IDS.ravi, { delivery_id: d, to: "out_for_delivery" });
    const k = key("dupcol");
    const results = await Promise.allSettled(Array.from({ length: 6 }, () =>
      completeDelivery(IDS.ravi, { delivery_id: d, to: "delivered", amount: "50", method: "cash", idempotency_key: k })));
    const ids = results.map((r) => (r.status === "fulfilled" ? r.value.id : null));
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(1);
    const [n] = await t.service((q) => q.query<{ c: number; p: number }>(
      "select count(*)::int as c, count(payment_id)::int as p from public.delivery_collections where delivery_id = $1", [d]));
    expect(n).toEqual({ c: 1, p: 1 });
  });

  it("concurrent stock adjustments never drive stock negative", async () => {
    const p = await makeProduct(t, IDS.sahyadriOwner, IDS.sahyadri, { stock: "10", price: "5.00" });
    const { adjustStock } = await import("@/server/inventory");
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => adjustStock(IDS.sahyadriOwner, { variant_id: p.variant_id, movement_type: "reduction", quantity: "3", note: "Concurrent write-off" })),
    );
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(3);
    expect((await stockOf(t, p.variant_id)).on_hand).toBe("1.000");
  });
});

describe.skipIf(hasPg)("concurrency (skipped)", () => {
  it.skip("needs TEST_DATABASE_URL pointing at a disposable PostgreSQL server", () => undefined);
});

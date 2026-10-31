/**
 * Row-Level Security and tenant isolation (section 18 cases 1-9).
 * Each check runs as a real demo user through `SET LOCAL ROLE authenticated`
 * plus JWT claims, exactly how the application and Supabase run queries.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDS, freshDatabase, key, rejects, type TestDb } from "../support/test-db";
import { placeOrder, getOrder } from "@/server/orders";
import { listInventory, adjustStock } from "@/server/inventory";
import { getInvoice } from "@/server/billing";
import { getMyDelivery, updateDelivery } from "@/server/deliveries";
import { setCartQuantity } from "@/server/cart";
import { createProduct } from "@/server/catalog";
import { setCompanyStatus } from "@/server/admin";

let t: TestDb;
let sahyadriOrder: string;
let sahyadriVariant: string;
let sahyadriUnit: string;
let ganeshInvoice: string;
let sunilDelivery: string;

const count = async (userId: string | null, sql: string, params: unknown[] = []) =>
  (await t.as(userId, (q) => q.query<{ n: number }>(`select count(*)::int as n from (${sql}) x`, params)))[0]!.n;

beforeAll(async () => {
  t = await freshDatabase();
  const [r] = await t.service((q) =>
    q.query<{ order_id: string; variant_id: string; unit_id: string; invoice_id: string; delivery_id: string }>(
      `select (select id from public.orders where wholesaler_id = $1 order by placed_at limit 1) as order_id,
              (select v.id from public.product_variants v where v.company_id = $1 order by v.sku limit 1) as variant_id,
              (select vu.id from public.variant_units vu where vu.company_id = $1 and vu.min_order_qty = 1 order by vu.price desc limit 1) as unit_id,
              (select id from public.invoices where retailer_id = $2 and status = 'issued' limit 1) as invoice_id,
              (select id from public.deliveries where assigned_worker_id = $3 limit 1) as delivery_id`,
      [IDS.sahyadri, IDS.ganesh, IDS.sunil],
    ),
  );
  sahyadriOrder = r!.order_id;
  sahyadriVariant = r!.variant_id;
  sahyadriUnit = r!.unit_id;
  ganeshInvoice = r!.invoice_id;
  sunilDelivery = r!.delivery_id;
  expect([sahyadriOrder, sahyadriVariant, sahyadriUnit, ganeshInvoice, sunilDelivery].every(Boolean)).toBe(true);
});
afterAll(async () => t?.close());

describe("1. Wholesaler A cannot access Wholesaler B's private inventory", () => {
  it("sees its own stock but none of another wholesaler's", async () => {
    expect(await count(IDS.sahyadriOwner, "select * from public.inventory_balances where company_id = $1", [IDS.sahyadri])).toBeGreaterThan(0);
    expect(await count(IDS.annapurnaOwner, "select * from public.inventory_balances where company_id = $1", [IDS.sahyadri])).toBe(0);
    expect(await count(IDS.annapurnaOwner, "select * from public.stock_movements where company_id = $1", [IDS.sahyadri])).toBe(0);
    expect(await count(IDS.annapurnaOwner, "select * from public.suppliers where company_id = $1", [IDS.sahyadri])).toBe(0);
    const viaServer = await listInventory(IDS.annapurnaOwner, IDS.sahyadri, {}).catch(() => ({ rows: [] }));
    expect(viaServer.rows).toEqual([]);
  });

  it("cannot change another wholesaler's stock", async () => {
    await rejects(adjustStock(IDS.annapurnaOwner, { variant_id: sahyadriVariant, movement_type: "addition", quantity: "5", note: "Not mine" }));
    await rejects(t.as(IDS.annapurnaOwner, (q) => q.query("update public.inventory_balances set on_hand = 0 where company_id = $1", [IDS.sahyadri])));
  });
});

describe("2. Wholesaler A cannot access Wholesaler B's orders", () => {
  it("returns no rows and not-found through the server module", async () => {
    expect(await count(IDS.annapurnaOwner, "select * from public.orders where wholesaler_id = $1", [IDS.sahyadri])).toBe(0);
    expect(await count(IDS.annapurnaOwner, "select * from public.order_items where order_id = $1", [sahyadriOrder])).toBe(0);
    const err = await rejects(getOrder(IDS.annapurnaOwner, sahyadriOrder));
    expect((err as { kind?: string }).kind).toBe("not_found");
  });
});

describe("3. A retailer cannot access another retailer's invoices", () => {
  it("Om Sai cannot read Shree Ganesh invoices or payments", async () => {
    expect(await count(IDS.ganeshOwner, "select * from public.invoices where id = $1", [ganeshInvoice])).toBe(1);
    expect(await count(IDS.omsaiOwner, "select * from public.invoices where retailer_id = $1", [IDS.ganesh])).toBe(0);
    expect(await count(IDS.omsaiOwner, "select * from public.payments where retailer_id = $1", [IDS.ganesh])).toBe(0);
    expect(await count(IDS.omsaiOwner, "select * from public.invoice_balances where retailer_id = $1", [IDS.ganesh])).toBe(0);
    await rejects(getInvoice(IDS.omsaiOwner, ganeshInvoice));
  });
});

describe("4. An unapproved retailer cannot order from a restricted wholesaler", () => {
  it("Laxmi (pending with Sahyadri, which requires approval) is refused", async () => {
    const err = await rejects(
      placeOrder(IDS.laxmiOwner, { retailer_id: IDS.laxmi, wholesaler_id: IDS.sahyadri, items: [{ variant_unit_id: sahyadriUnit, quantity: "2" }], idempotency_key: key() }),
    );
    expect(err.message).toMatch(/approv|connect|permission/i);
    await rejects(setCartQuantity(IDS.laxmiOwner, IDS.laxmi, sahyadriUnit, "2"));
  });

  it("cannot see restricted prices before approval", async () => {
    const rows = await t.as(IDS.laxmiOwner, (q) => q.query<{ price: string }>("select price from public.variant_units where company_id = $1", [IDS.sahyadri]));
    expect(rows).toEqual([]);
    // Control: an approved retailer of the same wholesaler can see them.
    expect(await count(IDS.ganeshOwner, "select price from public.variant_units where company_id = $1", [IDS.sahyadri])).toBeGreaterThan(0);
  });
});

describe("5. A delivery worker cannot read unrelated deliveries", () => {
  it("Ravi cannot see Sunil's delivery or its order", async () => {
    expect(await count(IDS.sunil, "select * from public.deliveries where id = $1", [sunilDelivery])).toBe(1);
    expect(await count(IDS.ravi, "select * from public.deliveries where id = $1", [sunilDelivery])).toBe(0);
    expect(await count(IDS.ravi, "select * from public.my_deliveries where id = $1", [sunilDelivery])).toBe(0);
    expect(await count(IDS.imran, "select * from public.deliveries where wholesaler_id = $1", [IDS.sahyadri])).toBe(0);
    await rejects(getMyDelivery(IDS.ravi, sunilDelivery));
  });

  it("delivery workers cannot read invoices, payments or other stock", async () => {
    expect(await count(IDS.ravi, "select * from public.invoices")).toBe(0);
    expect(await count(IDS.ravi, "select * from public.payments")).toBe(0);
    expect(await count(IDS.ravi, "select * from public.inventory_balances")).toBe(0);
  });
});

describe("6. A delivery worker cannot update an unassigned delivery", () => {
  it("Ravi cannot change Sunil's delivery through the function or directly", async () => {
    const [before] = await t.service((q) => q.query<{ status: string }>("select status from public.deliveries where id = $1", [sunilDelivery]));
    await rejects(updateDelivery(IDS.ravi, { delivery_id: sunilDelivery, to: "failed", failure_reason: "Not mine" }));
    await rejects(t.as(IDS.ravi, (q) => q.query("update public.deliveries set status = 'delivered' where id = $1", [sunilDelivery])));
    const [after] = await t.service((q) => q.query<{ status: string }>("select status from public.deliveries where id = $1", [sunilDelivery]));
    expect(after!.status).toBe(before!.status);
  });
});

describe("7. A user cannot grant themselves an administrator role", () => {
  it("platform_admins is not writable by users", async () => {
    await rejects(t.as(IDS.ganeshOwner, (q) => q.query("insert into public.platform_admins (user_id, granted_by) values ($1, 'self')", [IDS.ganeshOwner])));
    const [r] = await t.service((q) => q.query<{ n: number }>("select count(*)::int n from public.platform_admins where user_id = $1", [IDS.ganeshOwner]));
    expect(r!.n).toBe(0);
  });

  it("a staff member cannot promote themselves to owner, and nobody can join a company directly", async () => {
    await rejects(
      t.as(IDS.sahyadriStaff, (q) => q.query("update public.company_memberships set role = 'owner' where user_id = $1 and company_id = $2", [IDS.sahyadriStaff, IDS.sahyadri])),
    );
    await rejects(
      t.as(IDS.ganeshOwner, (q) => q.query("insert into public.company_memberships (company_id, user_id, role) values ($1, $2, 'owner')", [IDS.sahyadri, IDS.ganeshOwner])),
    );
  });

  it("admin-only functions refuse non-admins", async () => {
    await rejects(setCompanyStatus(IDS.sahyadriOwner, IDS.annapurna, "suspended", "Competitor"));
    const [c] = await t.service((q) => q.query<{ status: string }>("select status from public.companies where id = $1", [IDS.annapurna]));
    expect(c!.status).toBe("active");
  });
});

describe("8. Anonymous users cannot access private business records", () => {
  it("anon reads nothing private and cannot call business functions", async () => {
    for (const table of ["orders", "invoices", "payments", "inventory_balances", "deliveries", "company_memberships", "profiles", "audit_logs", "cart_items"]) {
      const err = await t.as(null, (q) => q.query(`select * from public.${table} limit 1`)).then(
        (rows) => (rows.length === 0 ? null : new Error(`anon read ${table}`)),
        () => null, // permission denied is also a pass
      );
      expect(err, table).toBeNull();
    }
    await rejects(t.as(null, (q) => q.query("select app.adjust_stock($1, 'addition', 1, 'x', null, null, null)", [sahyadriVariant])));
  });

  it("anon can see only the public catalogue fields of listed wholesalers", async () => {
    const rows = await t.as(null, (q) => q.query<{ name: string }>("select * from app.search_wholesalers(18.52, 73.85, 50, null, null, null, 20, 0)"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.name === "Garden City Traders")).toBe(false); // suspended
  });
});

describe("9. A user cannot manipulate a company ID to bypass tenant isolation", () => {
  it("a retailer cannot order on behalf of another retailer", async () => {
    const err = await rejects(
      placeOrder(IDS.ganeshOwner, { retailer_id: IDS.omsai, wholesaler_id: IDS.sahyadri, items: [{ variant_unit_id: sahyadriUnit, quantity: "2" }], idempotency_key: key() }),
    );
    expect(err.message).toMatch(/member|permission|access/i);
    await rejects(setCartQuantity(IDS.ganeshOwner, IDS.omsai, sahyadriUnit, "2"));
  });

  it("a wholesaler cannot create products under another company's ID", async () => {
    const [ref] = await t.service((q) =>
      q.query<{ c: string; tx: string }>(
        "select (select id from public.product_categories where slug = 'biscuits' and company_id is null) as c, (select id from public.tax_classes where rate = 18 and company_id is null) as tx",
      ),
    );
    await rejects(
      createProduct(
        IDS.annapurnaOwner,
        IDS.sahyadri,
        { name: "Injected product", category_id: ref!.c, tax_class_id: ref!.tx, attributes: {} },
        { name: "1", sku: "INJ-1", base_unit: "piece", units: [{ unit_code: "piece", factor_to_base: "1", price: "1" }] },
      ),
    );
    expect(await count(IDS.sahyadriOwner, "select * from public.products where name = 'Injected product'")).toBe(0);
  });

  it("cannot move an existing row to another tenant", async () => {
    await rejects(
      t.as(IDS.annapurnaOwner, (q) =>
        q.query("update public.products set company_id = $1 where company_id = $2 returning id", [IDS.annapurna, IDS.sahyadri]).then((r) => {
          if (r.length === 0) throw new Error("no rows visible");
          return r;
        }),
      ),
    );
    await rejects(
      t.as(IDS.annapurnaOwner, (q) =>
        q.query("update public.products set company_id = $1 where company_id = $2 returning id", [IDS.sahyadri, IDS.annapurna]),
      ),
    );
  });

  it("forged JWT claims for an unknown user see nothing", async () => {
    expect(await count("00000000-0000-4000-8000-00000000dead", "select * from public.orders")).toBe(0);
    expect(await count("00000000-0000-4000-8000-00000000dead", "select * from public.companies where kind = 'retailer'")).toBe(0);
  });
});

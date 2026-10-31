/**
 * Test databases. Every test file gets its own fresh database with the real
 * migrations, RLS policies and demo seed:
 *
 * - default: an in-memory PGlite instance (no installation needed);
 * - TEST_DATABASE_URL set: a throwaway database created on that PostgreSQL
 *   server (named vf_test_<random>) and dropped afterwards. The URL must point
 *   at a disposable local server; never at production.
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { createPgliteDatabase } from "@/server/db/pglite";
import { createPostgresDatabase } from "@/server/db/postgres";
import { migrate, seed } from "@/server/db/migrate";
import { setDatabaseForTesting, type Database, type Queryable } from "@/server/db";

export const IDS = {
  admin: "00000000-0000-4000-8000-000000000001",
  sahyadriOwner: "00000000-0000-4000-8000-000000000101",
  sahyadriStaff: "00000000-0000-4000-8000-000000000102",
  annapurnaOwner: "00000000-0000-4000-8000-000000000201",
  konkanOwner: "00000000-0000-4000-8000-000000000301",
  ganeshOwner: "00000000-0000-4000-8000-000000001001",
  omsaiOwner: "00000000-0000-4000-8000-000000001002",
  laxmiOwner: "00000000-0000-4000-8000-000000001003",
  ravi: "00000000-0000-4000-8000-000000002001",
  sunil: "00000000-0000-4000-8000-000000002002",
  imran: "00000000-0000-4000-8000-000000002003",
  sahyadri: "10000000-0000-4000-8000-000000000001",
  annapurna: "10000000-0000-4000-8000-000000000002",
  konkan: "10000000-0000-4000-8000-000000000003",
  ganesh: "20000000-0000-4000-8000-000000000001",
  omsai: "20000000-0000-4000-8000-000000000002",
  laxmi: "20000000-0000-4000-8000-000000000003",
} as const;

export interface TestDb {
  db: Database;
  /** Owner connection that bypasses RLS: for arranging and inspecting state only. */
  service: <T>(fn: (q: Queryable) => Promise<T>) => Promise<T>;
  /** Run as a user with RLS applied, the same way the application does. */
  as: <T>(userId: string | null, fn: (q: Queryable) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
}

function adminUrl(url: string, dbName: string) {
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  return u.toString();
}

export async function freshDatabase(opts: { engine?: "pglite" | "postgres"; withSeed?: boolean } = {}): Promise<TestDb> {
  const engine = opts.engine ?? (process.env.TEST_DATABASE_URL ? "postgres" : "pglite");
  let db: Database;
  let drop: (() => Promise<void>) | null = null;
  if (engine === "postgres") {
    const base = process.env.TEST_DATABASE_URL;
    if (!base) throw new Error("TEST_DATABASE_URL is not set");
    const name = `vf_test_${randomBytes(4).toString("hex")}`;
    const admin = new pg.Client({ connectionString: base });
    await admin.connect();
    await admin.query(`create database ${name}`);
    await admin.end();
    db = createPostgresDatabase(adminUrl(base, name), 12);
    drop = async () => {
      const c = new pg.Client({ connectionString: base });
      await c.connect();
      await c.query(`drop database if exists ${name} with (force)`);
      await c.end();
    };
  } else {
    db = await createPgliteDatabase(null);
  }
  await migrate(db, { withShim: true });
  if (opts.withSeed !== false) await seed(db);
  setDatabaseForTesting(db);
  return {
    db,
    service: (fn) => db.transaction({ kind: "service" }, fn),
    as: (userId, fn) => db.transaction(userId ? { kind: "user", userId } : { kind: "anon" }, fn),
    close: async () => {
      await db.close();
      if (drop) await drop();
    },
  };
}

/**
 * Create a product through the real server function (RLS applies) with one
 * "piece" selling unit (min 1, step 1) and the given opening stock.
 */
export async function makeProduct(
  t: TestDb,
  ownerId: string,
  companyId: string,
  opts: { stock: string; price?: string; discount?: string; taxRate?: "0.00" | "5.00" | "18.00"; inclusive?: boolean; sku?: string },
) {
  const { createProduct } = await import("@/server/catalog");
  const [ref] = await t.service((q) =>
    q.query<{ category_id: string; tax_class_id: string }>(
      `select (select id from public.product_categories where slug = 'biscuits' and company_id is null) as category_id,
              (select id from public.tax_classes where company_id is null and rate = $1 limit 1) as tax_class_id`,
      [opts.taxRate ?? "18.00"],
    ),
  );
  const sku = opts.sku ?? `T-${randomBytes(3).toString("hex").toUpperCase()}`;
  const productId = await createProduct(
    ownerId,
    companyId,
    { name: `Test Biscuit ${sku}`, category_id: ref!.category_id, tax_class_id: ref!.tax_class_id, hsn_code: "1905", price_includes_tax: opts.inclusive ?? false, attributes: {} },
    {
      name: "100 g",
      sku,
      base_unit: "piece",
      opening_stock: opts.stock,
      units: [{ unit_code: "piece", factor_to_base: "1", price: opts.price ?? "10.00", discount_percent: opts.discount ?? "0", min_order_qty: "1", qty_step: "1", is_default: true }],
    },
  );
  const [row] = await t.service((q) =>
    q.query<{ variant_id: string; variant_unit_id: string }>(
      `select v.id as variant_id, vu.id as variant_unit_id from public.product_variants v
         join public.variant_units vu on vu.variant_id = v.id where v.product_id = $1`,
      [productId],
    ),
  );
  return { productId, ...row! };
}

export async function stockOf(t: TestDb, variantId: string) {
  const [row] = await t.service((q) =>
    q.query<{ on_hand: string; reserved: string; available: string }>(
      "select on_hand::text, reserved::text, available::text from public.inventory_balances where variant_id = $1",
      [variantId],
    ),
  );
  return row ?? { on_hand: "0.000", reserved: "0.000", available: "0.000" };
}

export const key = (prefix = "test") => `${prefix}-${randomBytes(8).toString("hex")}`;

/** Assert that a promise rejects (with any database or application error). */
export async function rejects(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (err) {
    return err as Error;
  }
  throw new Error("Expected the operation to be rejected, but it succeeded");
}

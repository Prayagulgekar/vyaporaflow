import "server-only";
import { getEnv, ConfigError } from "@/lib/env";
import { openDatabase } from "./factory";
import type { Database, DbActor, Queryable } from "./types";

export type { Database, DbActor, Queryable } from "./types";

const globalForDb = globalThis as unknown as { __vfDb?: Promise<Database> };

async function connect(): Promise<Database> {
  const env = getEnv();
  let db: Database;
  if (env.APP_MODE === "production") {
    db = await openDatabase({ engine: "postgres", url: env.DATABASE_URL, max: 10 });
  } else if (env.DEMO_DATABASE_URL) {
    db = await openDatabase({ engine: "postgres", url: env.DEMO_DATABASE_URL, max: 5 });
  } else {
    db = await openDatabase({ engine: "pglite", dataDir: env.DEMO_DB_PATH });
  }
  const ok = await db
    .transaction({ kind: "service" }, (q) => q.query<{ ok: boolean }>("select to_regclass('vf_meta.schema_migrations') is not null as ok"))
    .catch(() => [{ ok: false }]);
  if (env.APP_MODE === "demo" && !ok[0]?.ok) {
    await db.close();
    throw new ConfigError("The demo database has not been initialised. Run `npm run db:setup` (or `npm run dev`, which runs it first).");
  }
  return db;
}

/** Integration tests inject their own database (PGlite in memory or a test PostgreSQL). */
export function setDatabaseForTesting(db: Database) {
  globalForDb.__vfDb = Promise.resolve(db);
}

/** One database handle per server process (survives dev hot reloads). */
export function getDb(): Promise<Database> {
  globalForDb.__vfDb ??= connect().catch((err) => {
    globalForDb.__vfDb = undefined;
    throw err;
  });
  return globalForDb.__vfDb;
}

export async function withActor<T>(actor: DbActor, fn: (q: Queryable) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(actor, fn);
}

export const asUser = <T>(userId: string, fn: (q: Queryable) => Promise<T>) => withActor({ kind: "user", userId }, fn);
export const asAnon = <T>(fn: (q: Queryable) => Promise<T>) => withActor({ kind: "anon" }, fn);
/** Trusted context that bypasses RLS. See DbActor "service" for the permitted uses. */
export const asService = <T>(fn: (q: Queryable) => Promise<T>) => withActor({ kind: "service" }, fn);

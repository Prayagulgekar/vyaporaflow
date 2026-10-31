import { mkdirSync } from "node:fs";
import { PGlite, types } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { claimsFor, type Database, type DbActor, type Queryable, type Row } from "./types";

/**
 * Embedded PostgreSQL (PGlite, PostgreSQL compiled to WebAssembly) for local
 * demo mode. It runs the same migrations, RLS policies and PL/pgSQL functions
 * as production. It is single-connection: transactions are serialized, so it
 * cannot demonstrate concurrent-transaction behaviour (tested on PostgreSQL).
 */
const parsers = {
  [types.NUMERIC]: (v: string) => v,
  [types.INT8]: (v: string) => Number(v),
  [types.DATE]: (v: string) => v,
};

export async function createPgliteDatabase(dataDir: string | null): Promise<Database> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = await PGlite.create(dataDir ? { dataDir, extensions: { pgcrypto }, parsers } : { extensions: { pgcrypto }, parsers });

  return {
    engine: "pglite",
    async transaction<T>(actor: DbActor, fn: (q: Queryable) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => {
        const c = claimsFor(actor);
        if (c) {
          await tx.query("select set_config('request.jwt.claims', $1, true)", [c.claims]);
          await tx.exec(`set local role ${c.role}`);
        }
        const q: Queryable = {
          async query<R = Row>(sql: string, params: unknown[] = []) {
            const res = await tx.query<R>(sql, params);
            return res.rows;
          },
        };
        return fn(q);
      });
    },
    async execScript(sql: string) {
      await db.exec(sql);
    },
    async close() {
      await db.close();
    },
  };
}

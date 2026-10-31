import { readFileSync } from "node:fs";
import pg from "pg";
import { claimsFor, type Database, type DbActor, type Queryable, type Row } from "./types";

// Exact money: keep NUMERIC as strings; counts (INT8) as numbers; DATE as text.
pg.types.setTypeParser(1700, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1082, (v) => v);

/**
 * Verified TLS: when DATABASE_CA_CERT points to a CA certificate file (for
 * Supabase: Project settings > Database > SSL Configuration > Download
 * certificate), connections are encrypted and the server certificate is checked.
 */
function verifiedSsl(): pg.PoolConfig["ssl"] {
  const caPath = process.env.DATABASE_CA_CERT;
  if (!caPath) return undefined;
  return { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true };
}

/**
 * PostgreSQL over node-postgres. Used for production (Supabase pooler via
 * DATABASE_URL), optional local demo PostgreSQL, and integration tests.
 * Each transaction sets the request JWT claims and SET LOCAL ROLE so the
 * database applies the same RLS policies Supabase applies to API requests.
 */
export function createPostgresDatabase(connectionString: string, max = 10): Database {
  const pool = new pg.Pool({ connectionString, max, ssl: verifiedSsl() });
  return {
    engine: "postgres",
    async transaction<T>(actor: DbActor, fn: (q: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const c = claimsFor(actor);
        if (c) {
          await client.query("select set_config('request.jwt.claims', $1, true)", [c.claims]);
          await client.query(`set local role ${c.role}`);
        }
        const q: Queryable = {
          async query<R = Row>(sql: string, params: unknown[] = []) {
            const res = await client.query(sql, params);
            return res.rows as R[];
          },
        };
        const result = await fn(q);
        await client.query("commit");
        return result;
      } catch (err) {
        await client.query("rollback").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async execScript(sql: string) {
      const client = await pool.connect();
      try {
        await client.query(sql);
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Database } from "./types";

const ROOT = process.cwd();
export const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
export const SHIM_FILE = path.join(ROOT, "supabase", "local", "supabase_shim.sql");
export const SEED_FILE = path.join(ROOT, "supabase", "seed.sql");

export function listMigrations(): { version: string; file: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ version: f.replace(/\.sql$/, ""), file: path.join(MIGRATIONS_DIR, f) }));
}

/**
 * Apply the Supabase shim (local databases only) and pending migrations.
 * Each migration runs in its own transaction and is recorded in
 * vf_meta.schema_migrations. Hosted Supabase projects use `supabase db push`
 * instead, which tracks migrations itself.
 */
export async function migrate(db: Database, opts: { withShim: boolean }): Promise<string[]> {
  if (opts.withShim) {
    await db.execScript(readFileSync(SHIM_FILE, "utf8"));
  }
  await db.execScript(
    "create schema if not exists vf_meta; create table if not exists vf_meta.schema_migrations (version text primary key, applied_at timestamptz not null default now());",
  );
  const done = new Set(
    (await db.transaction({ kind: "service" }, (q) => q.query<{ version: string }>("select version from vf_meta.schema_migrations"))).map(
      (r) => r.version,
    ),
  );
  const applied: string[] = [];
  for (const m of listMigrations()) {
    if (done.has(m.version)) continue;
    const sql = readFileSync(m.file, "utf8");
    try {
      await db.execScript(
        `begin;\n${sql}\n;insert into vf_meta.schema_migrations (version) values ('${m.version}');\ncommit;`,
      );
    } catch (err) {
      await db.execScript("rollback;").catch(() => undefined);
      throw new Error(`Migration ${m.version} failed: ${(err as Error).message}`);
    }
    applied.push(m.version);
  }
  return applied;
}

export async function seed(db: Database): Promise<void> {
  await db.execScript(readFileSync(SEED_FILE, "utf8"));
}

export async function appliedMigrations(db: Database): Promise<string[]> {
  return (
    await db.transaction({ kind: "service" }, (q) =>
      q.query<{ version: string }>("select version from vf_meta.schema_migrations order by version"),
    )
  ).map((r) => r.version);
}

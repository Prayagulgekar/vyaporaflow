/**
 * Database command for local demo and development databases.
 *
 *   npm run db:setup     apply shim + migrations + demo seed (fresh database)
 *   npm run db:reset     delete the demo database and run setup again
 *   npm run db:migrate   apply pending migrations only
 *   npm run db:status    list applied migrations
 *   (npm run dev runs `predev`: setup in demo mode, nothing in production mode)
 *
 * Target: DEMO_DATABASE_URL (local PostgreSQL) if set, else PGlite at DEMO_DB_PATH.
 * This command refuses to run when APP_MODE=production: use the Supabase CLI
 * (`supabase db push`) for hosted projects.
 */
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { loadEnvFiles } from "./load-env";
import { openDatabase, type DbTarget } from "../src/server/db/factory";
import { appliedMigrations, migrate, seed } from "../src/server/db/migrate";

loadEnvFiles();

async function main() {
  const cmd = process.argv[2] ?? "setup";
  if (cmd === "predev") {
    // `npm run dev` prepares the local demo database. In production mode the
    // database is Supabase, managed with the Supabase CLI, so there is nothing to do.
    if (process.env.APP_MODE === "production") {
      console.log("APP_MODE=production: using Supabase (DATABASE_URL). Skipping the local demo database.");
      return;
    }
    return run("setup");
  }
  return run(cmd);
}

async function run(cmd: string) {
  if (process.env.APP_MODE === "production") {
    throw new Error("Refusing to modify a database while APP_MODE=production. Use `supabase db push` for Supabase projects.");
  }
  const url = process.env.DEMO_DATABASE_URL;
  const dir = process.env.DEMO_DB_PATH ?? ".data/pglite";
  const target: DbTarget = url ? { engine: "postgres", url, max: 2 } : { engine: "pglite", dataDir: dir };

  if (cmd === "reset") {
    if (url) {
      await recreatePostgresDatabase(url);
    } else if (existsSync(dir)) {
      rmSync(path.resolve(dir), { recursive: true, force: true });
    }
    console.log(`Reset ${url ? "PostgreSQL database" : `PGlite database at ${dir}`}`);
  }

  const db = await openDatabase(target);
  try {
    if (cmd === "status") {
      console.log((await appliedMigrations(db)).join("\n") || "(no migrations applied)");
      return;
    }
    const applied = await migrate(db, { withShim: true });
    console.log(applied.length ? `Applied migrations:\n  ${applied.join("\n  ")}` : "Migrations up to date");
    if (cmd === "setup" || cmd === "reset" || cmd === "seed") {
      const [{ n }] = await db.transaction({ kind: "service" }, (q) =>
        q.query<{ n: number }>("select count(*)::int as n from public.companies"),
      ) as [{ n: number }];
      if (n > 0 && cmd !== "seed") {
        console.log("Database already has data; skipping demo seed (use npm run db:reset to start over).");
      } else {
        const t = Date.now();
        await seed(db);
        console.log(`Loaded demonstration seed data in ${((Date.now() - t) / 1000).toFixed(1)}s`);
      }
    }
  } finally {
    await db.close();
  }
}

async function recreatePostgresDatabase(url: string) {
  const u = new URL(url);
  const name = u.pathname.replace(/^\//, "");
  if (!/^[a-z0-9_]+$/.test(name) || ["postgres", "template0", "template1"].includes(name)) {
    throw new Error(`Refusing to drop database "${name}"; use a dedicated demo database name`);
  }
  u.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: u.toString() });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

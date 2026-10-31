/**
 * Grant or revoke platform administrator access. This is the only way to
 * create an administrator: there is no public route or form for it.
 *
 *   npm run admin:grant -- someone@example.com            # grant
 *   npm run admin:grant -- someone@example.com --revoke   # revoke
 *
 * Connects with DATABASE_URL (production, run from a trusted machine) or the
 * demo database. The user must already have registered.
 */
import { loadEnvFiles } from "./load-env";
import { openDatabase, type DbTarget } from "../src/server/db/factory";

loadEnvFiles();

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const revoke = process.argv.includes("--revoke");
  if (!email || !email.includes("@")) throw new Error("Usage: npm run admin:grant -- <email> [--revoke]");
  const prod = process.env.APP_MODE === "production";
  const url = prod ? process.env.DATABASE_URL : process.env.DEMO_DATABASE_URL;
  if (prod && !url) throw new Error("DATABASE_URL is required when APP_MODE=production");
  const target: DbTarget = url ? { engine: "postgres", url, max: 1 } : { engine: "pglite", dataDir: process.env.DEMO_DB_PATH ?? ".data/pglite" };
  const db = await openDatabase(target);
  try {
    await db.transaction({ kind: "service" }, async (q) => {
      const [u] = await q.query<{ id: string }>("select id from auth.users where lower(email) = $1", [email]);
      if (!u) throw new Error(`No registered user with email ${email}`);
      if (revoke) {
        await q.query("delete from public.platform_admins where user_id = $1", [u.id]);
      } else {
        await q.query("insert into public.platform_admins (user_id, granted_by, note) values ($1, 'cli', 'Granted with npm run admin:grant') on conflict do nothing", [u.id]);
      }
      await q.query(
        "insert into public.audit_logs (company_id, actor_id, action, target_type, target_id, details) values (null, null, $1, 'user', $2, $3)",
        [revoke ? "admin.revoked" : "admin.granted", u.id, JSON.stringify({ via: "cli" })],
      );
    });
    console.log(`${revoke ? "Revoked" : "Granted"} platform administrator access for ${email}`);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

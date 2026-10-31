import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { asService } from "@/server/db";
import { AppError } from "@/server/errors";

/**
 * LOCAL DEMO AUTHENTICATION ONLY (APP_MODE=demo).
 * Email + password accounts in the local database. Passwords are hashed with
 * bcrypt (pgcrypto crypt/gen_salt('bf')); session tokens are random 256-bit
 * values stored only as SHA-256 hashes. Production uses Supabase Auth.
 */
export const DEMO_SESSION_COOKIE = "vf_session";
const SESSION_DAYS = 7;

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export async function demoRegister(input: { email: string; password: string; fullName: string; accountType: string }) {
  const email = input.email.trim().toLowerCase();
  return asService(async (q) => {
    const existing = await q.query("select 1 from auth.users where email = $1", [email]);
    if (existing.length) throw new AppError("conflict", "An account with this email already exists. Sign in instead.");
    const rows = await q.query<{ id: string }>(
      `insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data)
       values ($1, crypt($2, gen_salt('bf', 10)), now(), jsonb_build_object('full_name', $3::text, 'account_type', $4::text))
       returning id`,
      [email, input.password, input.fullName, input.accountType],
    );
    return rows[0]!.id;
  });
}

export async function demoVerifyPassword(emailRaw: string, password: string): Promise<{ id: string; email: string } | null> {
  const email = emailRaw.trim().toLowerCase();
  const rows = await asService((q) =>
    q.query<{ id: string; email: string; ok: boolean; banned: boolean }>(
      `select id, email, encrypted_password = crypt($2, encrypted_password) as ok,
              coalesce(banned_until > now(), false) as banned
         from auth.users where email = $1`,
      [email, password],
    ),
  );
  const u = rows[0];
  if (!u || !u.ok || u.banned) return null;
  return { id: u.id, email: u.email };
}

export async function demoCreateSession(userId: string): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await asService((q) =>
    q.query("insert into auth.demo_sessions (token_hash, user_id, expires_at) values ($1, $2, $3)", [sha256(token), userId, expires]),
  );
  return { token, expires };
}

export async function demoSessionUser(token: string | undefined): Promise<{ id: string; email: string } | null> {
  if (!token || token.length > 100) return null;
  const rows = await asService((q) =>
    q.query<{ id: string; email: string }>(
      `select u.id, u.email from auth.demo_sessions s join auth.users u on u.id = s.user_id
        where s.token_hash = $1 and s.expires_at > now()`,
      [sha256(token)],
    ),
  );
  return rows[0] ?? null;
}

export async function demoDestroySession(token: string | undefined) {
  if (!token) return;
  await asService((q) => q.query("delete from auth.demo_sessions where token_hash = $1", [sha256(token)]));
}

/**
 * Simulated password recovery: no email is sent in demo mode. The reset link
 * is returned so the UI can display it, clearly labelled as simulated.
 */
export async function demoCreatePasswordReset(emailRaw: string): Promise<string | null> {
  const email = emailRaw.trim().toLowerCase();
  const token = randomBytes(24).toString("base64url");
  const rows = await asService(async (q) => {
    const u = await q.query<{ id: string }>("select id from auth.users where email = $1", [email]);
    if (!u[0]) return [];
    await q.query(
      "insert into auth.demo_password_resets (token_hash, user_id, expires_at) values ($1, $2, now() + interval '30 minutes')",
      [sha256(token), u[0].id],
    );
    return u;
  });
  return rows.length ? token : null;
}

export async function demoResetPassword(token: string, password: string): Promise<boolean> {
  return asService(async (q) => {
    const r = await q.query<{ user_id: string }>(
      `update auth.demo_password_resets set used_at = now()
        where token_hash = $1 and used_at is null and expires_at > now() returning user_id`,
      [sha256(token)],
    );
    if (!r[0]) return false;
    await q.query("update auth.users set encrypted_password = crypt($2, gen_salt('bf', 10)), updated_at = now() where id = $1", [
      r[0].user_id,
      password,
    ]);
    await q.query("delete from auth.demo_sessions where user_id = $1", [r[0].user_id]);
    return true;
  });
}

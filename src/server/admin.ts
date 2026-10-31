import "server-only";
import { appliedMigrations } from "@/server/db/migrate";
import { getDb } from "@/server/db";
import { getEnv } from "@/lib/env";
import { AppError } from "@/server/errors";
import { callFn, clampPage, json, pageOf, userTx, type Page } from "@/server/rpc";
import { uuid } from "@/server/validation";

export async function adminOverview(userId: string) {
  return userTx(userId, (q) =>
    callFn<{ wholesalers: number; retailers: number; suspended: number; pending_verification: number; users: number; orders_30d: number; open_support: number; relationships_pending: number }>(
      q,
      "admin_overview",
    ),
  );
}

export interface AdminCompanyRow {
  id: string;
  name: string;
  kind: string;
  status: string;
  status_reason: string | null;
  verification_status: string;
  city: string | null;
  gstin: string | null;
  is_demo: boolean;
  created_at: Date;
  members: number;
  total_count: number;
}

export async function listCompanies(userId: string, opts: { q?: string; kind?: string; status?: string; verification?: string; page?: unknown }): Promise<Page<AdminCompanyRow>> {
  const page = clampPage(opts.page);
  const size = 20;
  const rows = await userTx(userId, (q) =>
    q.query<AdminCompanyRow>(
      `select c.id, c.name, c.kind, c.status, c.status_reason, c.verification_status, a.city, c.gstin, c.is_demo, c.created_at,
              (select count(*)::int from public.company_memberships m where m.company_id = c.id and m.status = 'active') as members,
              (count(*) over ())::int as total_count
         from public.companies c left join public.business_addresses a on a.company_id = c.id and a.is_primary
        where app.is_platform_admin()
          and ($1::text is null or c.name ilike '%' || $1 || '%' or c.gstin ilike '%' || $1 || '%')
          and ($2::text is null or c.kind::text = $2)
          and ($3::text is null or c.status::text = $3)
          and ($4::text is null or c.verification_status::text = $4)
        order by (c.verification_status = 'pending') desc, c.created_at desc limit $5 offset $6`,
      [opts.q?.trim() || null, opts.kind || null, opts.status || null, opts.verification || null, size, (page - 1) * size],
    ),
  );
  return pageOf(rows, page, size);
}

export async function setCompanyStatus(userId: string, companyId: string, status: string, reason: string | null) {
  uuid.parse(companyId);
  if (!["active", "suspended"].includes(status)) throw new AppError("validation", "Unknown status");
  await userTx(userId, (q) => callFn(q, "admin_set_company_status", [companyId, status, reason]));
}

export async function setVerification(userId: string, companyId: string, status: string, note: string | null) {
  uuid.parse(companyId);
  if (!["unverified", "pending", "verified", "rejected"].includes(status)) throw new AppError("validation", "Unknown verification status");
  await userTx(userId, (q) => callFn(q, "admin_set_verification", [companyId, status, note]));
}

export async function listUsers(userId: string, opts: { q?: string; page?: unknown }) {
  const page = clampPage(opts.page);
  const size = 25;
  const rows = await userTx(userId, (q) =>
    q.query<{ id: string; email: string; full_name: string; account_type: string | null; is_admin: boolean; companies: string | null; created_at: Date; total_count: number }>(
      "select * from app.admin_list_users($1, $2, $3)",
      [opts.q?.trim() || null, size, (page - 1) * size],
    ),
  );
  return pageOf(rows, page, size);
}

export async function listSupport(userId: string, opts: { status?: string; page?: unknown }) {
  const page = clampPage(opts.page);
  const size = 20;
  const rows = await userTx(userId, (q) =>
    q.query<{ id: string; name: string; email: string; phone: string | null; topic: string; message: string; status: string; source: string; admin_note: string | null; created_at: Date; company_name: string | null; total_count: number }>(
      `select s.id, s.name, s.email, s.phone, s.topic, s.message, s.status, s.source, s.admin_note, s.created_at, c.name as company_name,
              (count(*) over ())::int as total_count
         from public.support_requests s left join public.companies c on c.id = s.company_id
        where app.is_platform_admin() and ($1::text is null or s.status = $1)
        order by (s.status = 'open') desc, s.created_at desc limit $2 offset $3`,
      [opts.status || null, size, (page - 1) * size],
    ),
  );
  return pageOf(rows, page, size);
}

export async function updateSupport(userId: string, id: string, status: string, note: string | null) {
  uuid.parse(id);
  if (!["open", "in_progress", "closed"].includes(status)) throw new AppError("validation", "Unknown status");
  await userTx(userId, (q) => callFn(q, "admin_update_support", [id, status, note]));
}

export async function listSettings() {
  const db = await getDb();
  return db.transaction({ kind: "anon" }, (q) =>
    q.query<{ key: string; value: unknown; description: string | null; updated_at: Date }>(
      "select key, value, description, updated_at from public.platform_settings order by key",
    ),
  );
}

export async function setSetting(userId: string, key: string, rawValue: string) {
  let value: unknown;
  try {
    value = JSON.parse(rawValue);
  } catch {
    throw new AppError("validation", "Value must be valid JSON (for text, wrap it in double quotes)");
  }
  await userTx(userId, (q) => callFn(q, "admin_set_setting", [key, json(value)]));
}

export async function listAudit(userId: string, opts: { q?: string; page?: unknown; companyId?: string }) {
  const page = clampPage(opts.page);
  const size = 30;
  const rows = await userTx(userId, (q) =>
    q.query<{ id: number; action: string; target_type: string | null; target_id: string | null; details: Record<string, unknown>; created_at: Date; actor_name: string | null; company_name: string | null; total_count: number }>(
      `select l.id, l.action, l.target_type, l.target_id, l.details, l.created_at, p.full_name as actor_name, c.name as company_name,
              (count(*) over ())::int as total_count
         from public.audit_logs l left join public.profiles p on p.id = l.actor_id left join public.companies c on c.id = l.company_id
        where ($1::text is null or l.action ilike '%' || $1 || '%') and ($2::uuid is null or l.company_id = $2)
        order by l.id desc limit $3 offset $4`,
      [opts.q?.trim() || null, opts.companyId || null, size, (page - 1) * size],
    ),
  );
  return pageOf(rows, page, size);
}

export async function systemHealth() {
  const env = getEnv();
  const started = Date.now();
  const db = await getDb();
  const [row] = await db.transaction({ kind: "service" }, (q) =>
    q.query<{ version: string; now: Date; postgis: boolean }>(
      "select version(), now(), exists (select 1 from pg_extension where extname = 'postgis') as postgis",
    ),
  );
  // Local databases record migrations in vf_meta; Supabase projects (db push) in supabase_migrations.
  const migrations = await appliedMigrations(db).catch(() =>
    db
      .transaction({ kind: "service" }, (q) => q.query<{ version: string }>("select version from supabase_migrations.schema_migrations order by version"))
      .then((rows) => rows.map((r) => r.version))
      .catch(() => [] as string[]),
  );
  return {
    mode: env.APP_MODE,
    engine: db.engine,
    databaseVersion: row?.version ?? "unknown",
    postgis: row?.postgis ?? false,
    latencyMs: Date.now() - started,
    migrations,
    nodeVersion: process.version,
    serverTime: row?.now ?? new Date(),
  };
}

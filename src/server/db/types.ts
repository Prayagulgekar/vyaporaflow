/** Who a database transaction runs as. RLS policies see this identity. */
export type DbActor =
  | { kind: "user"; userId: string; email?: string | null }
  | { kind: "anon" }
  /**
   * Trusted server context (table owner, bypasses RLS). Used only for demo
   * authentication tables, migrations, seeding, the admin provisioning
   * command and health checks. Never for requests on behalf of a user.
   */
  | { kind: "service" };

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Database {
  readonly engine: "pglite" | "postgres";
  transaction<T>(actor: DbActor, fn: (q: Queryable) => Promise<T>): Promise<T>;
  /** Run a multi-statement script as the owner (migrations, seed). */
  execScript(sql: string): Promise<void>;
  close(): Promise<void>;
}

export function claimsFor(actor: DbActor): { role: string; claims: string } | null {
  if (actor.kind === "service") return null;
  if (actor.kind === "anon") return { role: "anon", claims: JSON.stringify({ role: "anon" }) };
  return {
    role: "authenticated",
    claims: JSON.stringify({ sub: actor.userId, role: "authenticated", email: actor.email ?? undefined }),
  };
}

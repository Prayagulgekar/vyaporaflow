import "server-only";
import { asAnon, asUser, type Queryable } from "@/server/db";
import { toAppError } from "@/server/errors";

/** Call an app.* database function and return its scalar result. */
export async function callFn<T = unknown>(q: Queryable, fn: string, args: unknown[] = []): Promise<T> {
  if (!/^[a-z_]+$/.test(fn)) throw new Error("Invalid function name");
  const params = args.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await q.query<{ r: T }>(`select app.${fn}(${params}) as r`, args);
  return rows[0]?.r as T;
}

/** Run as the given user with RLS applied; database errors become AppErrors. */
export async function userTx<T>(userId: string, fn: (q: Queryable) => Promise<T>): Promise<T> {
  try {
    return await asUser(userId, fn);
  } catch (err) {
    throw toAppError(err);
  }
}

export async function anonTx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
  try {
    return await asAnon(fn);
  } catch (err) {
    throw toAppError(err);
  }
}

export const json = (v: unknown) => JSON.stringify(v);

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export function pageOf<T extends { total_count?: number }>(rows: T[], page: number, pageSize: number): Page<T> {
  const total = rows[0]?.total_count ?? 0;
  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export function clampPage(raw: unknown): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 100000 ? n : 1;
}

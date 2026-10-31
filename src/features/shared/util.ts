import "server-only";
import { notFound } from "next/navigation";
import { AppError } from "@/server/errors";

/** Await a record lookup and render the 404 page if it does not exist or is not visible to this user. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof AppError && (err.kind === "not_found" || err.kind === "forbidden")) notFound();
    throw err;
  }
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Flatten Next.js search params to single strings. */
export async function params(sp: SearchParams): Promise<Record<string, string | undefined>> {
  const raw = await sp;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
}

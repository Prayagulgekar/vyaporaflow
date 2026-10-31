import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { AppError, toAppError } from "@/server/errors";

/** JSON error response with the AppError's HTTP status; internal errors are not detailed. */
export function apiError(err: unknown) {
  const e = err instanceof AppError ? err : toAppError(err);
  if (e.kind === "internal") console.error(err);
  return NextResponse.json({ error: e.kind === "internal" ? "Internal error" : e.message, fieldErrors: e.fieldErrors }, { status: e.status });
}

/** Cookie-authenticated writes must come from this site (CSRF protection for the JSON API). */
export function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) throw new AppError("forbidden", "Missing Origin header");
  const allowed = new Set([new URL(getEnv().NEXT_PUBLIC_APP_URL).origin, req.nextUrl.origin]);
  if (!allowed.has(origin)) throw new AppError("forbidden", "Cross-site request refused");
}

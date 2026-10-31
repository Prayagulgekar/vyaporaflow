import { AppError, toAppError } from "@/server/errors";

export interface ActionState {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  /** Small payload for the client, e.g. a one-time invitation link. */
  data?: Record<string, string>;
}

export const initialActionState: ActionState = { ok: false };

export function actionError(err: unknown): ActionState {
  const e = err instanceof AppError ? err : toAppError(err);
  return { ok: false, message: e.message, fieldErrors: e.fieldErrors };
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}

/** Next.js redirect()/notFound() throw control-flow errors that must propagate. */
export function isNavigationError(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND");
}

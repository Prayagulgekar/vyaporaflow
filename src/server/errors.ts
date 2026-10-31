/** Application errors with an HTTP-like status, mapped from database errors. */
export type ErrorKind = "unauthenticated" | "forbidden" | "not_found" | "conflict" | "validation" | "internal";

const STATUS: Record<ErrorKind, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation: 422,
  internal: 500,
};

export class AppError extends Error {
  readonly kind: ErrorKind;
  readonly status: number;
  readonly fieldErrors?: Record<string, string[]>;
  constructor(kind: ErrorKind, message: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = "AppError";
    this.kind = kind;
    this.status = STATUS[kind];
    this.fieldErrors = fieldErrors;
  }
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  inventory_balances_check: "Stock cannot go below the quantity reserved for open orders",
  inventory_balances_on_hand_check: "Stock on hand cannot be negative",
  product_variants_company_id_sku_key: "That SKU is already used by another product",
  variant_units_variant_id_unit_code_key: "This variant already has that selling unit",
  companies_slug_key: "That business address name is taken",
  brands_name_key: "That brand already exists",
  product_categories_slug_key: "That category already exists",
  delivery_zones_check: "A radius zone needs a radius; a PIN code zone needs at least one PIN code",
};

interface PgLikeError {
  code?: string;
  message?: string;
  constraint?: string;
}

/** Convert anything thrown by the data layer into an AppError with a user-safe message. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const e = (err ?? {}) as PgLikeError;
  const code = e.code ?? "";
  const msg = e.message ?? "Unexpected error";
  switch (code) {
    case "VF401":
      return new AppError("unauthenticated", msg);
    case "VF403":
      return new AppError("forbidden", msg);
    case "VF404":
      return new AppError("not_found", msg);
    case "VF409":
      return new AppError("conflict", msg);
    case "VF422":
      return new AppError("validation", msg);
    case "42501": // insufficient_privilege, including RLS WITH CHECK violations
      return new AppError("forbidden", "You do not have permission to do that");
    case "23505":
      return new AppError("conflict", CONSTRAINT_MESSAGES[e.constraint ?? ""] ?? "That record already exists");
    case "23514":
    case "23502":
    case "23503":
    case "22P02":
    case "22003":
    case "22001":
      return new AppError("validation", CONSTRAINT_MESSAGES[e.constraint ?? ""] ?? "Some of the values are not valid");
    default:
      if (err instanceof Error && err.name === "ConfigError") return new AppError("internal", err.message);
      console.error("[vyaporaflow] unexpected error", err);
      return new AppError("internal", "Something went wrong. Please try again.");
  }
}

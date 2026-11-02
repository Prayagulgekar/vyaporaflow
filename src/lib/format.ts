import { whatsappUrl } from "@/lib/whatsapp";
export { formatINR } from "@/domain/money";
export { formatQuantity } from "@/domain/units";

const TZ = "Asia/Kolkata";

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: TZ,
});
const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ });

function toDate(v: Date | string): Date {
  if (v instanceof Date) return v;
  // Plain dates (YYYY-MM-DD) are calendar dates in India; anchor them at IST noon.
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00+05:30`) : new Date(v);
}

export function formatDate(v: Date | string | null | undefined): string {
  return v ? dateFmt.format(toDate(v)) : "—";
}

/** Date and time in India Standard Time (all timestamps are stored in UTC). */
export function formatDateTime(v: Date | string | null | undefined): string {
  return v ? dateTimeFmt.format(toDate(v)) : "—";
}

export function formatTime(v: Date | string | null | undefined): string {
  return v ? timeFmt.format(toDate(v)) : "—";
}

export function todayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

export function humanize(s: string | null | undefined): string {
  if (!s) return "";
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/**
 * wa.me link with a prefilled message, or null when the number is missing or
 * not a valid mobile number. Opens WhatsApp; nothing is sent automatically.
 * Kept for compatibility: new code uses src/lib/whatsapp.ts directly.
 */
export function whatsappLink(phone: string | null | undefined, message: string): string | null {
  return whatsappUrl(phone, message);
}

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  upi: "UPI (recorded manually)",
  cheque: "Cheque",
  other: "Other",
};

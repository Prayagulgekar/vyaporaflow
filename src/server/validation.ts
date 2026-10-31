import { z } from "zod";
import { isGstinFormat } from "@/domain/tax";

/** Shared input schemas. The database re-validates with constraints. */
const trimmed = (max: number) => z.string().trim().max(max);
export const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), trimmed(max).optional());

export const uuid = z.string().uuid({ message: "Invalid identifier" });
export const phone = z.string().trim().regex(/^\+?[0-9]{10,13}$/, "Enter a 10-digit mobile number");
export const optionalPhone = z.preprocess((v) => (v === "" ? undefined : v), phone.optional());
export const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(200);
export const optionalEmail = z.preprocess((v) => (v === "" ? undefined : v), email.optional());
export const pincode = z.string().trim().regex(/^[1-9][0-9]{5}$/, "Enter a 6-digit PIN code");
export const stateCode = z.string().regex(/^[0-9]{2}$/, "Choose a state");
export const gstin = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim().toUpperCase()) : v),
  z.string().refine(isGstinFormat, "GSTIN format looks wrong (15 characters, e.g. 27ABCDE1234F1Z5)").optional(),
);
export const money = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter an amount like 1250 or 1250.50");
export const positiveMoney = money.refine((v) => Number(v) > 0, "Amount must be greater than zero");
export const quantity = z
  .string()
  .trim()
  .regex(/^\d{1,7}(\.\d{1,3})?$/, "Enter a quantity")
  .refine((v) => Number(v) > 0, "Quantity must be greater than zero");
export const percent = z
  .string()
  .trim()
  .regex(/^\d{1,2}(\.\d{1,2})?$/, "Enter a percentage between 0 and 99.99");
export const latitude = z.coerce.number().min(-90).max(90);
export const longitude = z.coerce.number().min(-180).max(180);
export const password = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v), "Use letters and at least one number");
export const language = z.enum(["en", "hi", "mr", "gu", "ta", "te", "kn", "bn"]);

export const addressSchema = z.object({
  line1: z.string().trim().min(3, "Enter the street address").max(200),
  line2: optionalText(200),
  city: z.string().trim().min(2, "Enter the city").max(80),
  state_code: stateCode,
  pincode,
  latitude: z.preprocess((v) => (v === "" || v === null ? undefined : v), latitude.optional()),
  longitude: z.preprocess((v) => (v === "" || v === null ? undefined : v), longitude.optional()),
});

export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

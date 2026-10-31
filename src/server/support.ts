import "server-only";
import { z } from "zod";
import { asAnon, asUser } from "@/server/db";
import { AppError, toAppError } from "@/server/errors";
import { callFn } from "@/server/rpc";
import { email, fieldErrors, optionalPhone } from "@/server/validation";

export const contactSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(120),
  email,
  phone: optionalPhone,
  topic: z.enum(["sales", "support", "partnership", "other"], { message: "Choose a topic" }),
  message: z.string().trim().min(10, "Write at least 10 characters").max(4000),
  website: z.string().max(0, "Leave this field empty").optional(), // honeypot
});

/** Stores the message in support_requests, visible to platform administrators. No email is sent. */
export async function submitContact(userId: string | null, input: unknown, source: "contact_form" | "in_app" = "contact_form") {
  const r = contactSchema.safeParse(input);
  if (!r.success) throw new AppError("validation", "Please correct the highlighted fields", fieldErrors(r.error));
  const d = r.data;
  try {
    const run = userId ? (fn: Parameters<typeof asUser>[1]) => asUser(userId, fn) : asAnon;
    return await run((q) => callFn<string>(q, "submit_support_request", [d.name, d.email, d.phone ?? null, d.topic, d.message, source]));
  } catch (err) {
    throw toAppError(err);
  }
}

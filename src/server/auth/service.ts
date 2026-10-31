import "server-only";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { AppError } from "@/server/errors";
import { email, fieldErrors, password } from "@/server/validation";
import { clearRateLimit, rateLimit } from "./rate-limit";
import {
  DEMO_SESSION_COOKIE,
  demoCreatePasswordReset,
  demoCreateSession,
  demoDestroySession,
  demoRegister,
  demoResetPassword,
  demoVerifyPassword,
} from "./demo";
import { createSupabaseServerClient } from "./supabase";

export const registerSchema = z.object({
  full_name: z.string().trim().min(2, "Enter your name").max(120),
  email,
  password,
  // Only public account types. "admin" is not accepted here or anywhere in public registration.
  account_type: z.enum(["wholesaler", "retailer", "delivery_worker"], { message: "Choose how you will use VyaporaFlow" }),
});

export const loginSchema = z.object({ email, password: z.string().min(1, "Enter your password").max(128) });

async function clientKey(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

async function setDemoCookie(token: string, expires: Date) {
  (await cookies()).set(DEMO_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && getEnv().NEXT_PUBLIC_APP_URL.startsWith("https"),
    path: "/",
    expires,
  });
}

export type RegisterResult = { status: "signed_in" } | { status: "confirm_email" };

export async function register(input: unknown): Promise<RegisterResult> {
  const r = registerSchema.safeParse(input);
  if (!r.success) throw new AppError("validation", "Please correct the highlighted fields", fieldErrors(r.error));
  if (!rateLimit(`register:${await clientKey()}`, 10, 60 * 60_000)) {
    throw new AppError("conflict", "Too many sign-ups from this network. Try again later.");
  }
  const d = r.data;
  const env = getEnv();
  if (env.APP_MODE === "demo") {
    const userId = await demoRegister({ email: d.email, password: d.password, fullName: d.full_name, accountType: d.account_type });
    const s = await demoCreateSession(userId);
    await setDemoCookie(s.token, s.expires);
    return { status: "signed_in" };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: d.email,
    password: d.password,
    options: {
      data: { full_name: d.full_name, account_type: d.account_type },
      emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/onboarding`,
    },
  });
  if (error) throw new AppError("validation", error.message);
  return data.session ? { status: "signed_in" } : { status: "confirm_email" };
}

/** Signs in and returns the user's id. */
export async function login(input: unknown): Promise<{ userId: string }> {
  const r = loginSchema.safeParse(input);
  if (!r.success) throw new AppError("validation", "Enter your email and password", fieldErrors(r.error));
  const key = `login:${await clientKey()}:${r.data.email}`;
  if (!rateLimit(key, 10, 15 * 60_000)) throw new AppError("conflict", "Too many sign-in attempts. Wait 15 minutes and try again.");
  const env = getEnv();
  if (env.APP_MODE === "demo") {
    const user = await demoVerifyPassword(r.data.email, r.data.password);
    if (!user) throw new AppError("unauthenticated", "Email or password is incorrect");
    const s = await demoCreateSession(user.id);
    await setDemoCookie(s.token, s.expires);
    clearRateLimit(key); // only failed attempts count towards the limit
    return { userId: user.id };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: r.data.email, password: r.data.password });
  if (error) throw new AppError("unauthenticated", error.message === "Email not confirmed" ? "Confirm your email address first" : "Email or password is incorrect");
  clearRateLimit(key);
  return { userId: data.user.id };
}

export async function logout(): Promise<void> {
  const env = getEnv();
  if (env.APP_MODE === "demo") {
    const store = await cookies();
    await demoDestroySession(store.get(DEMO_SESSION_COOKIE)?.value);
    store.delete(DEMO_SESSION_COOKIE);
    return;
  }
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}

/**
 * Production: Supabase emails a recovery link. Demo: no email service exists,
 * so the link is returned for on-screen display (clearly labelled as simulated).
 * The response does not reveal whether the email is registered (production).
 */
export async function requestPasswordReset(emailRaw: string): Promise<{ simulatedLink: string | null }> {
  const e = email.safeParse(emailRaw);
  if (!e.success) throw new AppError("validation", "Enter a valid email address");
  if (!rateLimit(`reset:${await clientKey()}`, 5, 15 * 60_000)) throw new AppError("conflict", "Too many requests. Try again later.");
  const env = getEnv();
  if (env.APP_MODE === "demo") {
    const token = await demoCreatePasswordReset(e.data);
    return { simulatedLink: token ? `/reset-password?token=${token}` : null };
  }
  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(e.data, { redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password` });
  return { simulatedLink: null };
}

export async function resetPassword(token: string | null, newPassword: string): Promise<void> {
  const p = password.safeParse(newPassword);
  if (!p.success) throw new AppError("validation", p.error.issues[0]?.message ?? "Choose a stronger password", { password: p.error.issues.map((i) => i.message) });
  const env = getEnv();
  if (env.APP_MODE === "demo") {
    if (!token || !(await demoResetPassword(token, p.data))) throw new AppError("conflict", "This reset link is invalid or has expired");
    return;
  }
  // Supabase: the recovery link signed the user in via /auth/callback; update the password for that session.
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: p.data });
  if (error) throw new AppError("conflict", error.message);
}

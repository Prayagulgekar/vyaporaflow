import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { getEnv } from "@/lib/env";
import { DEMO_SESSION_COOKIE, demoSessionUser } from "./demo";
import { createSupabaseServerClient } from "./supabase";

export interface SessionUser {
  id: string;
  email: string;
}

/**
 * The authenticated user for this request, validated server-side:
 * demo mode looks up the hashed session token; production asks Supabase Auth
 * to validate the JWT (getUser), never trusting unverified cookie contents.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const env = getEnv();
  if (env.APP_MODE === "demo") {
    const store = await cookies();
    return demoSessionUser(store.get(DEMO_SESSION_COOKIE)?.value);
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "" };
});

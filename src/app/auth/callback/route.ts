import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/server/auth/supabase";

/** Supabase email confirmation and password recovery links land here (production only). */
export async function GET(request: NextRequest) {
  const env = getEnv();
  const url = new URL(request.url);
  const nextRaw = url.searchParams.get("next") ?? "/app";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/app";
  if (env.APP_MODE !== "production") return NextResponse.redirect(new URL("/login", env.NEXT_PUBLIC_APP_URL));
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, env.NEXT_PUBLIC_APP_URL));
  }
  return NextResponse.redirect(new URL("/login?error=link", env.NEXT_PUBLIC_APP_URL));
}

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PROTECTED = ["/w", "/r", "/d", "/admin", "/onboarding", "/account", "/notifications"];

function isProtected(pathname: string) {
  if (pathname === "/admin/login") return false;
  return PROTECTED.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * Runs before routes render. It only refreshes the Supabase session cookie
 * (production) and sends visitors without any session cookie to sign in.
 * It is an optimisation, not the security boundary: every page and server
 * action re-validates the session, and PostgreSQL RLS checks every query.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const mode = process.env.APP_MODE ?? "demo";
  let signedIn = false;

  if (mode === "production" && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    signedIn = Boolean(data.user);
  } else {
    signedIn = Boolean(request.cookies.get("vf_session")?.value);
  }

  if (!signedIn && isProtected(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = request.nextUrl.pathname.startsWith("/admin") ? "/admin/login" : "/login";
    url.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|screenshots/|api/files/|.*\\.(?:png|jpg|jpeg|webp|svg|ico)$).*)"],
};

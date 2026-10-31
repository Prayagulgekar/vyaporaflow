import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers,
 * using the public anon key and the user's auth cookies. The service-role key
 * is never used here and never reaches the browser.
 */
export async function createSupabaseServerClient() {
  const env = getEnv();
  if (env.APP_MODE !== "production") throw new Error("Supabase client requested outside production mode");
  const store = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there. The
          // proxy refreshes the session on the next request.
        }
      },
    },
  });
}

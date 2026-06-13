import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Server Supabase client for Server Components, Route Handlers, and Server
 * Actions. Bound to the request cookies so the user's session travels with it;
 * RLS still applies (this is the user's JWT, not the service role).
 *
 * In a Server Component the cookie store is read-only, so writes are wrapped in
 * try/catch — session refresh is handled by the middleware instead.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component — safe to ignore; middleware
            // refreshes the session cookie on the response.
          }
        },
      },
    },
  );
}

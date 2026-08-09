import "server-only";
import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Service-role Supabase client — bypasses RLS entirely. The highest-privilege
 * credential this codebase touches, so the rules are strict:
 *
 * - ONE consumer: the account-deletion route handler. Do not import this
 *   anywhere else without a SECURITY.md update.
 * - Constructed per request, never a module-level singleton — the key is
 *   read only when a verified session has already asked for deletion.
 * - `import "server-only"` makes any client-bundle import a build error.
 * - Returns null when SUPABASE_SERVICE_ROLE_KEY isn't configured so callers
 *   fail closed with a clear message instead of crashing mid-flow (the key
 *   ships to the deployment env only when account deletion is enabled).
 */
export function createAdminClient(): SupabaseClient<Database> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

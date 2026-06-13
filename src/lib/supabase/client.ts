"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Browser Supabase client (FINAL_PLAN D7).  Uses the public URL + publishable
 * key only — never the service role key.  RLS enforces per-user isolation, so
 * this client can only ever see the signed-in user's own rows.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

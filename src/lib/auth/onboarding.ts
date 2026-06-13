import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type ProfileGate = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "auth_method" | "password_set"
>;

/**
 * Magic-link accounts must set a durable password at onboarding (D15/A4). OAuth
 * accounts use the provider as their credential and are never gated. Pure so it
 * can be unit-tested and reused by the route handler, middleware, and layout.
 */
export function needsPasswordOnboarding(profile: ProfileGate | null): boolean {
  return (
    !!profile && profile.auth_method === "magic_link" && profile.password_set === false
  );
}

/** Where to send a user immediately after a successful sign-in. */
export async function postAuthRedirect(
  supabase: SupabaseClient<Database>,
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "/sign-in";

  const { data: profile } = await supabase
    .from("profiles")
    .select("auth_method, password_set")
    .eq("user_id", user.id)
    .maybeSingle();

  return needsPasswordOnboarding(profile) ? "/set-password" : "/enhance";
}

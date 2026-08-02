import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Owner console plumbing (2026-08). The deployment owner is named by the
 * OWNER_EMAIL env var (server-side only, like the provider keys) — nothing
 * personal is committed to the repo. The database records which auth.uid()
 * claimed ownership so `update_app_settings` can enforce writes without the
 * database ever needing to see the env var: env decides WHO MAY claim, the
 * row records WHO DID.
 */

export interface AppSettings {
  ownerUserId: string | null;
  /** false = only the owner can register for or use the app. */
  openAccess: boolean;
  /** Library-card developer-accent peak alpha, percent (see dev-accents.css). */
  devAccentStrength: number;
}

/** Matches the migration's column defaults — and what the app assumes when
 *  the row cannot be read (fail OPEN on availability: a missing settings row
 *  must never lock everyone out). */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  ownerUserId: null,
  openAccess: true,
  devAccentStrength: 26,
};

/** Bounds mirror the migration's CHECK constraint. */
export const DEV_ACCENT_STRENGTH_MIN = 0;
export const DEV_ACCENT_STRENGTH_MAX = 60;

/**
 * The rule the authed layout server-renders to apply the stored accent
 * strength. It MUST target `:root`: dev-accents.css derives `--dev-peak`
 * AT `:root`, and a custom property substituted there can never see a value
 * declared on a descendant — the previous carrier (a wrapper div's style
 * attribute) was masked entirely, so the stored strength never rendered
 * after a load and only the owner slider's live preview (an inline style on
 * `<html>`, which resolves at `:root`) ever took. That same inline preview
 * keeps winning DURING a drag because inline style out-cascades this rule.
 *
 * Clamped to the CHECK-constraint bounds and integer-rounded: the string is
 * interpolated into a `<style>` element, so nothing unvalidated may ride it.
 */
export function devAccentCss(strength: number): string {
  const bounded = Math.min(
    DEV_ACCENT_STRENGTH_MAX,
    Math.max(
      DEV_ACCENT_STRENGTH_MIN,
      Number.isFinite(strength)
        ? Math.round(strength)
        : DEFAULT_APP_SETTINGS.devAccentStrength,
    ),
  );
  return `:root{--dev-peak-user:${bounded}%}`;
}

export async function getAppSettings(
  supabase: SupabaseClient<Database>,
): Promise<AppSettings> {
  const { data } = await supabase
    .from("app_settings")
    .select("owner_user_id, open_access, dev_accent_strength")
    .eq("id", 1)
    .maybeSingle();
  if (!data) return DEFAULT_APP_SETTINGS;
  return {
    ownerUserId: data.owner_user_id,
    openAccess: data.open_access,
    devAccentStrength: data.dev_accent_strength,
  };
}

/** True when the address is the configured owner email. Unset env means no
 *  one is the owner — the console fails closed. */
export function isOwnerEmail(email: string | null | undefined): boolean {
  const configured = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!configured || !email) return false;
  return email.trim().toLowerCase() === configured;
}

/**
 * Owner test for gating (console visibility, closed-access bypass): the
 * recorded claimant, or the env-named address before/without a claim. The
 * env match is deliberately sufficient on its own — the owner must be able
 * to reach the console (and their own app) even before first claim.
 */
export function isOwnerUser(
  user: Pick<User, "id" | "email"> | null,
  settings: AppSettings,
): boolean {
  if (!user) return false;
  if (settings.ownerUserId !== null && user.id === settings.ownerUserId) return true;
  return isOwnerEmail(user.email);
}

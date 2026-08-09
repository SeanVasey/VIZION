"use server";

import { revalidatePath } from "next/cache";
import {
  RATE_LIMITED_MESSAGE,
  emailLimited,
  writeLimited,
} from "@/lib/security/action-limit";
import { createClient } from "@/lib/supabase/server";
import { describeWriteError, writeErrorLogLine } from "@/lib/supabase/errors";
import type { Database } from "@/lib/supabase/database.types";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

type ProfilePatch = {
  full_name?: string | null;
  display_name?: string | null;
  default_model?: Database["public"]["Enums"]["model_target"];
  theme?: Database["public"]["Enums"]["theme"];
  avatar_url?: string | null;
};

/**
 * Update the signed-in user's profile. RLS confines the write to the owner row;
 * `display_name` uniqueness is enforced by a DB constraint and surfaced here.
 */
/**
 * The only hosts an avatar may load from (audit SEC-006). This mirrors
 * next/image remotePatterns (`*.supabase.co` wildcard + the two OAuth CDNs);
 * the CSP img-src is NARROWER — it pins the exact configured Supabase origin
 * (SEC-001). The client renders avatar_url with `unoptimized` (Supabase
 * transforms it already), which skips remotePatterns, so the server is where
 * this allowlist must live.
 */
function isAllowedAvatarUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const configuredHost = configured ? new URL(configured).hostname : null;
    return (
      u.hostname === configuredHost ||
      u.hostname.endsWith(".supabase.co") ||
      u.hostname === "lh3.googleusercontent.com" ||
      u.hostname === "avatars.githubusercontent.com"
    );
  } catch {
    return false;
  }
}

export async function updateProfileAction(patch: ProfilePatch): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Your session expired — sign in again." };
  if (writeLimited(user.id, "profile-write")) {
    return { ok: false, error: RATE_LIMITED_MESSAGE };
  }
  // An arbitrary string here would render on /profile from any origin the
  // attacker of one's own account chooses — allowlist it server-side.
  if (
    patch.avatar_url !== undefined &&
    patch.avatar_url !== null &&
    !isAllowedAvatarUrl(patch.avatar_url)
  ) {
    return { ok: false, error: "That avatar location isn't allowed." };
  }

  // Normalise empties to null and trim text fields.
  const update: ProfilePatch = {};
  if (patch.full_name !== undefined) update.full_name = patch.full_name?.trim() || null;
  if (patch.display_name !== undefined) {
    update.display_name = patch.display_name?.trim() || null;
    // Mirror the client rule (audit VAR-08 / OBS-3): the slug format was
    // enforced only by the Save button's gate, so any other caller could
    // store a value the settings screen then flags as invalid.
    if (update.display_name !== null && !/^[a-z0-9_-]{3,24}$/.test(update.display_name)) {
      return {
        ok: false,
        error:
          "Display names are 3–24 characters: lowercase letters, numbers, hyphen (-) or underscore (_).",
      };
    }
  }
  if (patch.default_model !== undefined) update.default_model = patch.default_model;
  if (patch.theme !== undefined) update.theme = patch.theme;
  if (patch.avatar_url !== undefined) update.avatar_url = patch.avatar_url;

  const { error } = await supabase.from("profiles").update(update).eq("user_id", user.id);

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "That display name is taken." };
    }
    // `default_model` is the `model_target` enum — a roster entry whose
    // migration is unapplied fails here the same way a save does.
    return { ok: false, error: describeWriteError(error, "Couldn't save changes.") };
  }

  // Identity edits log to the activity feed (spec §5 flow — the enum value
  // existed but was never emitted). Preference flips (theme/default model)
  // are deliberately not logged: they'd spam the feed on every toggle.
  if (
    update.full_name !== undefined ||
    update.display_name !== undefined ||
    update.avatar_url !== undefined
  ) {
    await supabase.from("activity_events").insert({
      user_id: user.id,
      type: "profile_updated",
      meta: {},
    });
  }

  revalidatePath("/profile");
  return { ok: true };
}

/**
 * Change the account email. Supabase sends a confirmation to the new address;
 * the change applies once confirmed — a distinct VERIFIED workflow, no longer
 * batched into the identity save (2026-07 UX audit).
 */
export async function updateEmailAction(email: string): Promise<ActionResult> {
  const trimmed = email.trim();
  if (!trimmed) return { ok: false, error: "Enter an email address." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Your session expired — sign in again." };
  // Each call sends real mail to an arbitrary address — the tightest budget.
  if (emailLimited(user.id, "profile-email")) {
    return { ok: false, error: RATE_LIMITED_MESSAGE };
  }
  const { error } = await supabase.auth.updateUser({ email: trimmed });
  if (error) {
    console.error(writeErrorLogLine("profile", "write", error));
    return { ok: false, error: describeWriteError(error, "Couldn't save that change.") };
  }
  return { ok: true };
}

/**
 * Export the user's data as JSON (Settings → Data & privacy): profile,
 * prompts + all versions, and media METADATA (the objects themselves stay in
 * storage — the export lists what exists, not the bytes). RLS scopes every
 * query to the owner.
 */
export async function exportDataAction(): Promise<{
  ok: boolean;
  json?: string;
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Your session expired — sign in again." };

  const [profile, prompts, versions, media] = await Promise.all([
    supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("prompts").select("*").order("created_at", { ascending: true }),
    supabase.from("prompt_versions").select("*").order("created_at", { ascending: true }),
    supabase
      .from("media_assets")
      .select(
        "id, storage_path, kind, size_bytes, created_at, original_name, mime_type, role, status",
      )
      .order("created_at", { ascending: true }),
  ]);
  const failed = profile.error ?? prompts.error ?? versions.error ?? media.error ?? null;
  if (failed) return { ok: false, error: failed.message };

  return {
    ok: true,
    json: JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        profile: profile.data,
        prompts: prompts.data,
        prompt_versions: versions.data,
        media_assets: media.data,
      },
      null,
      2,
    ),
  };
}

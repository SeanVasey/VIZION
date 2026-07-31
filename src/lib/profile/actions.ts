"use server";

import { revalidatePath } from "next/cache";
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
export async function updateProfileAction(patch: ProfilePatch): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Your session expired — sign in again." };

  // Normalise empties to null and trim text fields.
  const update: ProfilePatch = {};
  if (patch.full_name !== undefined) update.full_name = patch.full_name?.trim() || null;
  if (patch.display_name !== undefined) {
    update.display_name = patch.display_name?.trim() || null;
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

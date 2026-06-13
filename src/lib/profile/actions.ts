"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
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
    return { ok: false, error: error.message };
  }

  revalidatePath("/profile");
  return { ok: true };
}

/**
 * Change the account email. Supabase sends a confirmation to the new address;
 * the change applies once confirmed.
 */
export async function updateEmailAction(email: string): Promise<ActionResult> {
  const trimmed = email.trim();
  if (!trimmed) return { ok: false, error: "Enter an email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email: trimmed });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

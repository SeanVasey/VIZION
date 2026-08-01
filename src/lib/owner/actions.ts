"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/security/rate-limit";
import {
  DEV_ACCENT_STRENGTH_MAX,
  DEV_ACCENT_STRENGTH_MIN,
  getAppSettings,
  isOwnerEmail,
} from "@/lib/owner/settings";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface OwnerSettingsPatch {
  openAccess?: boolean;
  devAccentStrength?: number;
}

/**
 * Owner-console write path. Double-gated: the session email must match
 * OWNER_EMAIL (or the session uid must already be the recorded claimant),
 * and the database function independently requires the recorded claimant —
 * a spoofed client call fails at BOTH layers.
 */
export async function updateOwnerSettingsAction(
  patch: OwnerSettingsPatch,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Your session expired — sign in again." };

  if (!rateLimit(`owner:${user.id}`, 20, 60_000).allowed) {
    return { ok: false, error: "Too many changes — wait a moment." };
  }

  const settings = await getAppSettings(supabase);
  const recordedOwner =
    settings.ownerUserId !== null && settings.ownerUserId === user.id;
  if (!recordedOwner && !isOwnerEmail(user.email)) {
    return { ok: false, error: "Only the owner can change these settings." };
  }

  // Validate server-side; the slider/switch are conveniences.
  const update: {
    p_open_access?: boolean;
    p_dev_accent_strength?: number;
  } = {};
  if (patch.openAccess !== undefined) {
    if (typeof patch.openAccess !== "boolean") {
      return { ok: false, error: "Invalid access value." };
    }
    update.p_open_access = patch.openAccess;
  }
  if (patch.devAccentStrength !== undefined) {
    const s = patch.devAccentStrength;
    if (
      typeof s !== "number" ||
      !Number.isInteger(s) ||
      s < DEV_ACCENT_STRENGTH_MIN ||
      s > DEV_ACCENT_STRENGTH_MAX
    ) {
      return { ok: false, error: "Accent strength must be a whole percentage 0–60." };
    }
    update.p_dev_accent_strength = s;
  }
  if (Object.keys(update).length === 0) return { ok: true };

  // Bind (or confirm) the claim before writing. `false` means a DIFFERENT
  // account already holds the claim — surfaced, never silently rebound.
  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_app_ownership",
  );
  if (claimError) return { ok: false, error: "Couldn't verify ownership." };
  if (!claimed) {
    return { ok: false, error: "Ownership is already held by another account." };
  }

  const { error } = await supabase.rpc("update_app_settings", update);
  if (error) return { ok: false, error: "Couldn't save owner settings." };

  revalidatePath("/profile");
  return { ok: true };
}

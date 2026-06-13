"use server";

import { createClient } from "@/lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const MIN_PASSWORD = 8;

/**
 * Set a durable password for the signed-in account and mark onboarding complete
 * (D15/A4). Runs server-side against the user's session; RLS confines the
 * profile update to the owner's row.
 */
export async function setPasswordAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < MIN_PASSWORD) {
    return { ok: false, error: `Use at least ${MIN_PASSWORD} characters.` };
  }
  if (password !== confirm) {
    return { ok: false, error: "Passwords don't match." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Your session expired — sign in again." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, error: error.message };

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ password_set: true })
    .eq("user_id", user.id);
  if (profileError) return { ok: false, error: profileError.message };

  return { ok: true };
}

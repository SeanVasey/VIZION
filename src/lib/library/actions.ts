"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { MODES, TARGET_MODELS, type ModeId, type TargetModelId } from "@/lib/constants";
import { deriveTitle } from "@/lib/library/util";

export interface SaveResult {
  ok: boolean;
  promptId?: string;
  error?: string;
}

const MODE_IDS = new Set<string>(MODES.map((m) => m.id));
const TARGET_IDS = new Set<string>(TARGET_MODELS.map((m) => m.id));

interface VersionInput {
  input: string;
  output: string;
  rationale?: string | null;
  mode: ModeId;
  target: TargetModelId;
  modelUsed: string;
  tokenIn: number;
  tokenOut: number;
}

function validate(v: VersionInput): string | null {
  if (!v.input.trim() || !v.output.trim()) return "Nothing to save.";
  if (!MODE_IDS.has(v.mode)) return "Unknown mode.";
  if (!TARGET_IDS.has(v.target)) return "Unknown target model.";
  return null;
}

/** Save an enhancement as a new Prompt + its first immutable PromptVersion. */
export async function savePromptAction(
  v: VersionInput,
  title?: string,
  tags: string[] = [],
): Promise<SaveResult> {
  const invalid = validate(v);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Your session expired — sign in again." };

  const promptTitle = title?.trim() || deriveTitle(v.input);

  const { data: prompt, error: pErr } = await supabase
    .from("prompts")
    .insert({ user_id: user.id, title: promptTitle, target_model: v.target, tags })
    .select("id")
    .single();
  if (pErr || !prompt) return { ok: false, error: pErr?.message ?? "Couldn't save." };

  const { data: ver, error: vErr } = await supabase
    .from("prompt_versions")
    .insert({
      prompt_id: prompt.id,
      input_text: v.input,
      output_text: v.output,
      rationale: v.rationale ?? null,
      mode: v.mode,
      model_used: v.modelUsed,
      token_in: v.tokenIn,
      token_out: v.tokenOut,
    })
    .select("id")
    .single();
  if (vErr || !ver)
    return { ok: false, error: vErr?.message ?? "Couldn't save version." };

  await supabase.from("prompts").update({ current_ver: ver.id }).eq("id", prompt.id);
  await supabase.from("activity_events").insert([
    {
      user_id: user.id,
      prompt_id: prompt.id,
      type: "created",
      meta: { title: promptTitle },
    },
    { user_id: user.id, prompt_id: prompt.id, type: "saved", meta: {} },
  ]);

  revalidatePath("/library");
  return { ok: true, promptId: prompt.id };
}

/** Append a new immutable version (parent = current) and make it current. */
export async function addVersionAction(
  promptId: string,
  v: VersionInput,
): Promise<SaveResult> {
  const invalid = validate(v);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Your session expired — sign in again." };

  const { data: prompt } = await supabase
    .from("prompts")
    .select("current_ver")
    .eq("id", promptId)
    .single();

  const { data: ver, error: vErr } = await supabase
    .from("prompt_versions")
    .insert({
      prompt_id: promptId,
      parent_ver: prompt?.current_ver ?? null,
      input_text: v.input,
      output_text: v.output,
      rationale: v.rationale ?? null,
      mode: v.mode,
      model_used: v.modelUsed,
      token_in: v.tokenIn,
      token_out: v.tokenOut,
    })
    .select("id")
    .single();
  if (vErr || !ver)
    return { ok: false, error: vErr?.message ?? "Couldn't save version." };

  await supabase.from("prompts").update({ current_ver: ver.id }).eq("id", promptId);
  await supabase.from("activity_events").insert([
    { user_id: user.id, prompt_id: promptId, type: "enhanced", meta: {} },
    { user_id: user.id, prompt_id: promptId, type: "saved", meta: {} },
  ]);

  revalidatePath(`/library/${promptId}`);
  revalidatePath("/library");
  return { ok: true, promptId };
}

/** Restore a version: point current_ver at it (versions stay immutable). */
export async function restoreVersionAction(
  promptId: string,
  versionId: string,
): Promise<SaveResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Your session expired — sign in again." };

  // Grab the title in the same round trip so the activity feed can render
  // "Restored a version of “<title>”" instead of a dangling verb.
  const { data: updated, error } = await supabase
    .from("prompts")
    .update({ current_ver: versionId })
    .eq("id", promptId)
    .select("title")
    .single();
  if (error) return { ok: false, error: error.message };

  await supabase.from("activity_events").insert({
    user_id: user.id,
    prompt_id: promptId,
    type: "restored",
    meta: { version_id: versionId, title: updated?.title },
  });

  revalidatePath(`/library/${promptId}`);
  revalidatePath("/library");
  return { ok: true, promptId };
}

/** Update a prompt's tags. */
export async function updateTagsAction(
  promptId: string,
  tags: string[],
): Promise<SaveResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("prompts").update({ tags }).eq("id", promptId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/library/${promptId}`);
  revalidatePath("/library");
  return { ok: true, promptId };
}

/** Record a share event (display-name attributed feed entry). */
export async function logShareAction(promptId: string): Promise<SaveResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  await supabase.from("activity_events").insert({
    user_id: user.id,
    prompt_id: promptId,
    type: "shared",
    meta: {},
  });
  return { ok: true, promptId };
}

/** Delete a prompt and its versions (cascade). */
export async function deletePromptAction(promptId: string): Promise<SaveResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("prompts").delete().eq("id", promptId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/library");
  return { ok: true };
}

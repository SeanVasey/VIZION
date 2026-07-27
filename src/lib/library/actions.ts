"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { MODES, TARGET_MODELS, type ModeId, type TargetModelId } from "@/lib/constants";
import { describeWriteError } from "@/lib/supabase/errors";
import { deriveTitle } from "@/lib/library/util";
import { contentHash } from "@/lib/library/hash";
import { parseLibraryParams } from "@/lib/library/paging";
import { queryLibraryPage, type PromptCard } from "@/lib/library/queries";

export interface SaveResult {
  ok: boolean;
  promptId?: string;
  error?: string;
  /** Exact-duplicate detection: this content already exists in the library —
   *  offer "Save as new version" instead of minting a second identical card. */
  duplicate?: { promptId: string; title: string };
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
  /** Model-suggested semantic title (envelope `title`) — rides inside the
   *  payload so the offline outbox replay keeps it too. */
  title?: string;
}

function validate(v: VersionInput): string | null {
  if (!v.input.trim() || !v.output.trim()) return "Nothing to save.";
  if (!MODE_IDS.has(v.mode)) return "Unknown mode.";
  if (!TARGET_IDS.has(v.target)) return "Unknown target model.";
  return null;
}

/** Save an enhancement as a new Prompt + its first immutable PromptVersion.
 *  Exact duplicates (same input+output+mode, by content hash) are detected
 *  first and offered as "Save as new version" instead of a second card. */
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

  const hash = contentHash(v.input, v.output, v.mode);

  // Duplicate lookup — RLS already confines rows to the owner; the inner
  // join (disambiguated via prompt_id — current_ver is a second FK path)
  // excludes soft-deleted parents.
  const { data: dup } = await supabase
    .from("prompt_versions")
    .select("prompt_id, prompts!prompt_id!inner(title, deleted_at)")
    .eq("content_hash", hash)
    .is("prompts.deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (dup) {
    const parent = dup.prompts as unknown as { title: string };
    return {
      ok: false,
      duplicate: { promptId: dup.prompt_id, title: parent?.title ?? "Saved prompt" },
    };
  }

  const promptTitle = title?.trim() || v.title?.trim() || deriveTitle(v.input);

  const { data: prompt, error: pErr } = await supabase
    .from("prompts")
    .insert({ user_id: user.id, title: promptTitle, target_model: v.target, tags })
    .select("id")
    .single();
  // A target the app offers but the DB enum lacks (unapplied migration) lands
  // here as Postgres 22P02 — surface the model, not the internal error text.
  if (pErr || !prompt) {
    return { ok: false, error: describeWriteError(pErr, "Couldn't save.") };
  }

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
      content_hash: hash,
    })
    .select("id")
    .single();
  if (vErr || !ver) {
    return { ok: false, error: describeWriteError(vErr, "Couldn't save version.") };
  }

  await supabase
    .from("prompts")
    .update({
      current_ver: ver.id,
      preview: v.output.slice(0, 200),
      current_mode: v.mode,
    })
    .eq("id", prompt.id);
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

  const hash = contentHash(v.input, v.output, v.mode);
  // Appending the exact current content would be a no-op version — refuse.
  if (prompt?.current_ver) {
    const { data: cur } = await supabase
      .from("prompt_versions")
      .select("content_hash")
      .eq("id", prompt.current_ver)
      .single();
    if (cur?.content_hash === hash) {
      return { ok: false, error: "That's identical to the current version." };
    }
  }

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
      content_hash: hash,
    })
    .select("id")
    .single();
  if (vErr || !ver) {
    return { ok: false, error: describeWriteError(vErr, "Couldn't save version.") };
  }

  await supabase
    .from("prompts")
    .update({
      current_ver: ver.id,
      preview: v.output.slice(0, 200),
      current_mode: v.mode,
    })
    .eq("id", promptId);
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

  // The card's preview + mode follow the restored version.
  const { data: restored } = await supabase
    .from("prompt_versions")
    .select("output_text, mode")
    .eq("id", versionId)
    .single();

  // Grab the title in the same round trip so the activity feed can render
  // "Restored a version of “<title>”" instead of a dangling verb.
  const { data: updated, error } = await supabase
    .from("prompts")
    .update({
      current_ver: versionId,
      ...(restored
        ? { preview: restored.output_text.slice(0, 200), current_mode: restored.mode }
        : {}),
    })
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

/** Load the next library page (keyset cursor) — the "Load more" action.
 *  The raw filter is re-validated server-side; RLS scopes the rows. */
export async function fetchLibraryPageAction(
  rawFilter: Record<string, string | undefined>,
  cursor: string,
): Promise<{
  ok: boolean;
  cards?: PromptCard[];
  nextCursor?: string | null;
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Your session expired — sign in again." };
  try {
    const page = await queryLibraryPage(supabase, parseLibraryParams(rawFilter), cursor);
    return { ok: true, ...page };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't load more." };
  }
}

/** Rename a prompt (2026-07 UX audit: titles were immutable derivations). */
export async function updatePromptTitleAction(
  promptId: string,
  title: string,
): Promise<SaveResult> {
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > 120) {
    return { ok: false, error: "Give it a short name (1–120 characters)." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("prompts")
    .update({ title: trimmed })
    .eq("id", promptId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/library/${promptId}`);
  revalidatePath("/library");
  return { ok: true, promptId };
}

export async function setFavoriteAction(
  promptId: string,
  favorite: boolean,
): Promise<SaveResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("prompts")
    .update({ favorite })
    .eq("id", promptId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/library");
  return { ok: true, promptId };
}

export async function setArchivedAction(
  promptId: string,
  archived: boolean,
): Promise<SaveResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("prompts")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", promptId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/library");
  return { ok: true, promptId };
}

/** Soft delete — the library-surface delete, recoverable via the Undo toast. */
export async function softDeletePromptAction(promptId: string): Promise<SaveResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("prompts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", promptId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/library");
  return { ok: true, promptId };
}

export async function undoDeletePromptAction(promptId: string): Promise<SaveResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("prompts")
    .update({ deleted_at: null })
    .eq("id", promptId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/library");
  return { ok: true, promptId };
}

/** Permanently delete a prompt and its versions (cascade). Reserved for
 *  archived prompts — the everyday delete is soft + undoable. */
export async function deletePromptAction(promptId: string): Promise<SaveResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("prompts").delete().eq("id", promptId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/library");
  return { ok: true };
}

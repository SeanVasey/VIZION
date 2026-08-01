"use server";

import { revalidatePath } from "next/cache";
import { RATE_LIMITED_MESSAGE, writeLimited } from "@/lib/security/action-limit";
import { createClient } from "@/lib/supabase/server";
import { MODES, TARGET_MODELS, type ModeId, type TargetModelId } from "@/lib/constants";
import { describeWriteError, writeErrorLogLine } from "@/lib/supabase/errors";
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
  /**
   * A transient rejection the caller may safely retry later — a rate-limit
   * burst or an expired session, distinct from a permanent one (validation, a
   * persistent write error). The offline outbox reads this to keep a
   * rate-limited save QUEUED instead of counting it toward MAX_OUTBOX_ATTEMPTS:
   * a batch of >30 queued saves trips the per-user write limiter, and parking
   * that overflow after three flushes discards it even though the limiter
   * window clears in under a minute (Codex review, PR #75).
   */
  retryable?: boolean;
}

type Db = Awaited<ReturnType<typeof createClient>>;

const SESSION_EXPIRED = "Your session expired — sign in again.";

/**
 * The signed-in user's id, or null.
 *
 * Every mutation below scopes its write with `.eq("user_id", …)` as well as
 * relying on RLS. That redundancy is deliberate: RLS is otherwise the ONLY
 * thing standing between one of these server actions — reachable by any
 * authenticated client — and another account's row. A single dropped policy
 * (a table recreated during a schema change, an `alter table … disable row
 * level security` run during an incident) would turn `deletePromptAction` into
 * a cross-tenant delete, and nothing in the suite would notice. The predicate
 * costs one indexed column and removes the single point of failure.
 */
async function ownerId(supabase: Db): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
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
  if (!user) {
    return { ok: false, error: "Your session expired — sign in again.", retryable: true };
  }
  if (writeLimited(user.id, "library-write")) {
    return { ok: false, error: RATE_LIMITED_MESSAGE, retryable: true };
  }

  const hash = contentHash(v.input, v.output, v.mode, v.target);

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

  // One statement, one transaction. As four separate writes a failure after
  // the first left a `prompts` row with no version and a null `current_ver` —
  // a card that opens to nothing — and, because the content hash had nothing
  // to match on, the user's retry minted a second orphan instead of being
  // recognised as a duplicate. Only the first two writes had their errors
  // checked at all; the pointer update and the activity insert discarded
  // theirs.
  //
  // SECURITY INVOKER, so the owner policies still decide what may be written
  // and `auth.uid()` supplies the owner.
  const { data: promptId, error: pErr } = await supabase.rpc("library_save_prompt", {
    p_title: promptTitle,
    p_target: v.target,
    p_tags: tags,
    p_input: v.input,
    p_output: v.output,
    p_rationale: v.rationale ?? null,
    p_mode: v.mode,
    p_model_used: v.modelUsed,
    p_token_in: v.tokenIn,
    p_token_out: v.tokenOut,
    p_content_hash: hash,
  });
  // A target the app offers but the DB enum lacks (unapplied migration) lands
  // here as Postgres 22P02 — surface the model, not the internal error text.
  if (pErr || !promptId) {
    return { ok: false, error: describeWriteError(pErr, "Couldn't save.") };
  }

  revalidatePath("/library");
  return { ok: true, promptId };
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
  if (writeLimited(user.id, "library-write")) {
    return { ok: false, error: RATE_LIMITED_MESSAGE };
  }

  // `deleted_at is null`: a soft-deleted (trash) prompt is excluded from
  // every list and the duplicate check, but kept accepting new versions —
  // writes into the trash resurrect nothing and surprise everyone (LIB-006).
  const { data: prompt } = await supabase
    .from("prompts")
    .select("current_ver")
    .eq("id", promptId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .single();

  const hash = contentHash(v.input, v.output, v.mode, v.target);
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

  // Same transaction guarantee as savePromptAction. The RPC also takes a row
  // lock on the parent, so two concurrent appends cannot both read the same
  // `current_ver` and produce two versions claiming the same parent.
  const { data: ver, error: vErr } = await supabase.rpc("library_add_version", {
    p_prompt_id: promptId,
    p_input: v.input,
    p_output: v.output,
    p_rationale: v.rationale ?? null,
    p_mode: v.mode,
    p_model_used: v.modelUsed,
    p_token_in: v.tokenIn,
    p_token_out: v.tokenOut,
    p_content_hash: hash,
  });
  if (vErr || !ver) {
    return { ok: false, error: describeWriteError(vErr, "Couldn't save version.") };
  }

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
  if (writeLimited(user.id, "library-write")) {
    return { ok: false, error: RATE_LIMITED_MESSAGE };
  }

  // The card's preview + mode follow the restored version.
  // `.eq("prompt_id", promptId)` is the half that was missing: without it a
  // version id belonging to a DIFFERENT prompt was accepted, and `current_ver`
  // was pointed across a prompt boundary while `preview` silently kept the old
  // text. The sibling getVersionBodyAction has always carried this predicate.
  // The database now refuses it too (`version_not_owned_by_prompt`); this
  // returns a sentence instead of surfacing that as a raw write error.
  const { data: restored } = await supabase
    .from("prompt_versions")
    .select("output_text, mode, prompts!prompt_id!inner(deleted_at)")
    .eq("id", versionId)
    .eq("prompt_id", promptId)
    .is("prompts.deleted_at", null)
    .single();
  if (!restored) {
    return { ok: false, error: "That version doesn't belong to this prompt." };
  }

  // Grab the title in the same round trip so the activity feed can render
  // "Restored a version of “<title>”" instead of a dangling verb.
  const { data: updated, error } = await supabase
    .from("prompts")
    .update({
      current_ver: versionId,
      preview: restored.output_text.slice(0, 200),
      current_mode: restored.mode,
    })
    .eq("id", promptId)
    .eq("user_id", user.id)
    .select("title")
    .single();
  if (error) {
    console.error(writeErrorLogLine("library", "write", error));
    return { ok: false, error: describeWriteError(error, "Couldn't save that change.") };
  }

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
  const uid = await ownerId(supabase);
  if (!uid) return { ok: false, error: SESSION_EXPIRED };
  if (writeLimited(uid, "library-write")) {
    return { ok: false, error: RATE_LIMITED_MESSAGE };
  }
  const { error } = await supabase
    .from("prompts")
    .update({ tags })
    .eq("id", promptId)
    .eq("user_id", uid);
  if (error) {
    console.error(writeErrorLogLine("library", "write", error));
    return { ok: false, error: describeWriteError(error, "Couldn't save that change.") };
  }
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
  if (writeLimited(user.id, "library-write")) {
    return { ok: false, error: RATE_LIMITED_MESSAGE };
  }
  await supabase.from("activity_events").insert({
    user_id: user.id,
    prompt_id: promptId,
    type: "shared",
    meta: {},
  });
  return { ok: true, promptId };
}

export interface VersionBody {
  id: string;
  input_text: string;
  output_text: string;
  rationale: string | null;
}

/** Fetch one version's full body on demand (2026-07 UX audit: the detail
 *  page ships version METADATA only — bodies load lazily as the compare
 *  selects need them). RLS joins through the parent prompt. */
export async function getVersionBodyAction(
  promptId: string,
  versionId: string,
): Promise<{ ok: boolean; body?: VersionBody; error?: string }> {
  const supabase = await createClient();
  const uid = await ownerId(supabase);
  if (!uid) return { ok: false, error: SESSION_EXPIRED };
  // Owner-scoped through the parent as well as by id. This returns a version's
  // full input and output, so RLS being the only control would make one
  // dropped policy a cross-tenant read of prompt bodies.
  const { data: owned } = await supabase
    .from("prompts")
    .select("id")
    .eq("id", promptId)
    .eq("user_id", uid)
    .maybeSingle();
  if (!owned) return { ok: false, error: "Version not found." };
  const { data, error } = await supabase
    .from("prompt_versions")
    .select("id, input_text, output_text, rationale")
    .eq("id", versionId)
    .eq("prompt_id", promptId)
    .single();
  if (error || !data) {
    return { ok: false, error: describeWriteError(error, "Version not found.") };
  }
  return { ok: true, body: data };
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
    // Raw PostgREST text names columns/policies/enums — log it, say less
    // (SEC-005; the mutation paths' describeWriteError policy).
    console.error(
      writeErrorLogLine("library", "page", {
        message: e instanceof Error ? e.message : String(e),
      }),
    );
    return { ok: false, error: "Couldn't load more." };
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
  const uid = await ownerId(supabase);
  if (!uid) return { ok: false, error: SESSION_EXPIRED };
  if (writeLimited(uid, "library-write")) {
    return { ok: false, error: RATE_LIMITED_MESSAGE };
  }
  const { error } = await supabase
    .from("prompts")
    .update({ title: trimmed })
    .eq("id", promptId)
    .eq("user_id", uid);
  if (error) {
    console.error(writeErrorLogLine("library", "write", error));
    return { ok: false, error: describeWriteError(error, "Couldn't save that change.") };
  }
  revalidatePath(`/library/${promptId}`);
  revalidatePath("/library");
  return { ok: true, promptId };
}

export async function setFavoriteAction(
  promptId: string,
  favorite: boolean,
): Promise<SaveResult> {
  const supabase = await createClient();
  const uid = await ownerId(supabase);
  if (!uid) return { ok: false, error: SESSION_EXPIRED };
  if (writeLimited(uid, "library-write")) {
    return { ok: false, error: RATE_LIMITED_MESSAGE };
  }
  const { error } = await supabase
    .from("prompts")
    .update({ favorite })
    .eq("id", promptId)
    .eq("user_id", uid);
  if (error) {
    console.error(writeErrorLogLine("library", "write", error));
    return { ok: false, error: describeWriteError(error, "Couldn't save that change.") };
  }
  revalidatePath("/library");
  return { ok: true, promptId };
}

export async function setArchivedAction(
  promptId: string,
  archived: boolean,
): Promise<SaveResult> {
  const supabase = await createClient();
  const uid = await ownerId(supabase);
  if (!uid) return { ok: false, error: SESSION_EXPIRED };
  if (writeLimited(uid, "library-write")) {
    return { ok: false, error: RATE_LIMITED_MESSAGE };
  }
  const { error } = await supabase
    .from("prompts")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", promptId)
    .eq("user_id", uid);
  if (error) {
    console.error(writeErrorLogLine("library", "write", error));
    return { ok: false, error: describeWriteError(error, "Couldn't save that change.") };
  }
  revalidatePath("/library");
  return { ok: true, promptId };
}

/** Soft delete — the library-surface delete, recoverable via the Undo toast. */
export async function softDeletePromptAction(promptId: string): Promise<SaveResult> {
  const supabase = await createClient();
  const uid = await ownerId(supabase);
  if (!uid) return { ok: false, error: SESSION_EXPIRED };
  if (writeLimited(uid, "library-write")) {
    return { ok: false, error: RATE_LIMITED_MESSAGE };
  }
  const { error } = await supabase
    .from("prompts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", promptId)
    .eq("user_id", uid);
  if (error) {
    console.error(writeErrorLogLine("library", "write", error));
    return { ok: false, error: describeWriteError(error, "Couldn't save that change.") };
  }
  revalidatePath("/library");
  return { ok: true, promptId };
}

export async function undoDeletePromptAction(promptId: string): Promise<SaveResult> {
  const supabase = await createClient();
  const uid = await ownerId(supabase);
  if (!uid) return { ok: false, error: SESSION_EXPIRED };
  if (writeLimited(uid, "library-write")) {
    return { ok: false, error: RATE_LIMITED_MESSAGE };
  }
  const { error } = await supabase
    .from("prompts")
    .update({ deleted_at: null })
    .eq("id", promptId)
    .eq("user_id", uid);
  if (error) {
    console.error(writeErrorLogLine("library", "write", error));
    return { ok: false, error: describeWriteError(error, "Couldn't save that change.") };
  }
  revalidatePath("/library");
  return { ok: true, promptId };
}

/** Permanently delete a prompt and its versions (cascade). Reserved for
 *  archived prompts — the everyday delete is soft + undoable. */
export async function deletePromptAction(promptId: string): Promise<SaveResult> {
  const supabase = await createClient();
  const uid = await ownerId(supabase);
  if (!uid) return { ok: false, error: SESSION_EXPIRED };
  if (writeLimited(uid, "library-write")) {
    return { ok: false, error: RATE_LIMITED_MESSAGE };
  }
  // Archived OR trashed only (LIB-006 + Q9): the "reserved" rule in the doc
  // comment was enforced only by the UI hiding the button — a direct call
  // could permanently destroy an ACTIVE prompt. The trash sheet purges
  // soft-deleted rows through here too.
  const { data, error } = await supabase
    .from("prompts")
    .delete()
    .eq("id", promptId)
    .eq("user_id", uid)
    .or("archived_at.not.is.null,deleted_at.not.is.null")
    .select("id");
  if (error) {
    console.error(writeErrorLogLine("library", "write", error));
    return { ok: false, error: describeWriteError(error, "Couldn't save that change.") };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "Only archived or deleted prompts can be permanently deleted.",
    };
  }
  revalidatePath("/library");
  return { ok: true };
}

// --- Collections (2026-07 deferral, now landing) -------------------------

/** 23505 (unique_violation) on collections means the per-owner name clash. */
function describeCollectionError(err: { code?: string; message: string }): string {
  return err.code === "23505"
    ? "You already have a collection with that name."
    : describeWriteError(err, "Couldn't save the collection.");
}

/** Move a prompt into a collection (or out of every collection with null). */
export async function setCollectionAction(
  promptId: string,
  collectionId: string | null,
): Promise<SaveResult> {
  const supabase = await createClient();
  const uid = await ownerId(supabase);
  if (!uid) return { ok: false, error: SESSION_EXPIRED };
  if (writeLimited(uid, "library-write")) {
    return { ok: false, error: RATE_LIMITED_MESSAGE };
  }
  // A foreign-key check does NOT consult RLS, so without this a prompt could be
  // filed into another account's collection: the FK only asks whether the row
  // exists. The prompt would then vanish from its owner's collection filters
  // and belong to a collection they cannot see.
  if (collectionId !== null) {
    const { data: owned } = await supabase
      .from("collections")
      .select("id")
      .eq("id", collectionId)
      .eq("user_id", uid)
      .maybeSingle();
    if (!owned) return { ok: false, error: "That collection doesn't exist." };
  }
  const { error } = await supabase
    .from("prompts")
    .update({ collection_id: collectionId })
    .eq("id", promptId)
    .eq("user_id", uid);
  if (error) {
    console.error(writeErrorLogLine("library", "write", error));
    return { ok: false, error: describeWriteError(error, "Couldn't save that change.") };
  }
  revalidatePath("/library");
  return { ok: true, promptId };
}

export async function createCollectionAction(
  name: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 60) {
    return { ok: false, error: "Give it a short name (1–60 characters)." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Your session expired — sign in again." };
  if (writeLimited(user.id, "library-write")) {
    return { ok: false, error: RATE_LIMITED_MESSAGE };
  }
  const { data, error } = await supabase
    .from("collections")
    .insert({ user_id: user.id, name: trimmed })
    .select("id")
    .single();
  if (error) return { ok: false, error: describeCollectionError(error) };
  revalidatePath("/library");
  return { ok: true, id: data.id };
}

export async function renameCollectionAction(
  id: string,
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 60) {
    return { ok: false, error: "Give it a short name (1–60 characters)." };
  }
  const supabase = await createClient();
  const uid = await ownerId(supabase);
  if (!uid) return { ok: false, error: SESSION_EXPIRED };
  if (writeLimited(uid, "library-write")) {
    return { ok: false, error: RATE_LIMITED_MESSAGE };
  }
  const { error } = await supabase
    .from("collections")
    .update({ name: trimmed, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", uid);
  if (error) return { ok: false, error: describeCollectionError(error) };
  revalidatePath("/library");
  return { ok: true };
}

/** Delete a collection. Prompts inside are kept — the FK's on delete set
 *  null releases them (no client-side cleanup). */
export async function deleteCollectionAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const uid = await ownerId(supabase);
  if (!uid) return { ok: false, error: SESSION_EXPIRED };
  if (writeLimited(uid, "library-write")) {
    return { ok: false, error: RATE_LIMITED_MESSAGE };
  }
  const { error } = await supabase
    .from("collections")
    .delete()
    .eq("id", id)
    .eq("user_id", uid);
  if (error) {
    console.error(writeErrorLogLine("library", "write", error));
    return { ok: false, error: describeWriteError(error, "Couldn't save that change.") };
  }
  revalidatePath("/library");
  return { ok: true };
}

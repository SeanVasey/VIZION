"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  MODES,
  TARGET_MODELS,
  THINKING_LEVELS,
  type ModeId,
  type TargetModelId,
  type ThinkingLevel,
} from "@/lib/constants";
import { describeWriteError, writeErrorLogLine } from "@/lib/supabase/errors";
import { parseLibraryParams } from "@/lib/library/paging";
import { deriveTitle } from "@/lib/library/util";
import {
  isMissingDraftsTable,
  queryDraftsPage,
  type DraftCard,
} from "@/lib/drafts/queries";

export interface DraftResult {
  ok: boolean;
  draftId?: string;
  error?: string;
  /** The drafts table isn't there yet (migration pending). Distinct from a
   *  generic failure so the UI can say so instead of blaming the user's
   *  connection, and so the caller can decline to destroy local work. */
  unavailable?: boolean;
}

const MODE_IDS = new Set<string>(MODES.map((m) => m.id));
const TARGET_IDS = new Set<string>(TARGET_MODELS.map((m) => m.id));
const LEVEL_IDS = new Set<string>(THINKING_LEVELS);

/** Same ceiling as the table's CHECK — rejected here so an over-long body
 *  comes back as a sentence rather than a constraint-violation message. */
const MAX_BODY = 100_000;

export interface DraftInput {
  body: string;
  target: TargetModelId;
  mode: ModeId;
  /** Absent/null = Auto. */
  thinkingLevel?: ThinkingLevel | null;
}

/** Body rules, shared by save and update so the two cannot diverge — an edit
 *  that accepts what a save rejects is a constraint violation waiting to
 *  surface as a raw Postgres message. */
function validateBody(body: string): string | null {
  if (!body.trim()) return "Nothing to save.";
  if (body.length > MAX_BODY) return "That draft is too long to save.";
  return null;
}

function validate(v: DraftInput): string | null {
  const badBody = validateBody(v.body);
  if (badBody) return badBody;
  if (!MODE_IDS.has(v.mode)) return "Unknown mode.";
  if (!TARGET_IDS.has(v.target)) return "Unknown target model.";
  if (v.thinkingLevel && !LEVEL_IDS.has(v.thinkingLevel)) {
    return "Unknown thinking level.";
  }
  return null;
}

/**
 * Save the composer's current state as a draft on the server.
 *
 * The whole composer state is captured, not just the text: resuming into
 * whichever model happened to be selected later would silently change what the
 * user gets back from a prompt they saved for a specific target.
 *
 * `unavailable` rather than a thrown error when the migration is pending — the
 * caller's next step is to destroy the local draft, and it must not do that on
 * the strength of a save that did not happen.
 */
export async function saveDraftAction(v: DraftInput): Promise<DraftResult> {
  const invalid = validate(v);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data, error } = await supabase
    .from("drafts")
    .insert({
      user_id: user.id,
      body: v.body,
      title: deriveTitle(v.body),
      target_model: v.target,
      mode: v.mode,
      thinking_level: v.thinkingLevel ?? null,
    })
    .select("id")
    .single();

  if (error) {
    if (isMissingDraftsTable(error)) {
      console.error(
        "[drafts] save failed — the drafts table is absent. Apply " +
          "supabase/migrations/20260730000000_drafts.sql to this project.",
      );
      return { ok: false, unavailable: true, error: "Drafts aren't set up yet." };
    }
    console.error(writeErrorLogLine("drafts", "save", error));
    return { ok: false, error: describeWriteError(error, "Couldn't save that draft.") };
  }

  revalidatePath("/library");
  return { ok: true, draftId: data.id };
}

/**
 * Edit a saved draft in place, without consuming it.
 *
 * Resuming a draft is a MOVE: it lands in the composer and the row is deleted.
 * That is right for "carry on writing this", and wrong for "fix a typo" or
 * "reword this and leave it saved" — which previously meant resume, edit, and
 * save a second time, with a window where the draft existed nowhere but this
 * device. This is the in-place path.
 *
 * BODY ONLY, on purpose. target/mode/thinking level are the composer's own
 * controls; editing them from a list row would mean rebuilding the mode rig and
 * the target picker in a sheet, and resuming is the better route for that. The
 * title is re-derived rather than editable for the same reason it is derived on
 * save — it is a view of the first line, not a separate field to keep in sync.
 *
 * `updated_at` is set explicitly. The column defaults to now() on INSERT only,
 * and there is no trigger, so without this an edited draft would keep its
 * original timestamp and sink down a list ordered by `updated_at desc` — edited
 * and apparently untouched.
 *
 * A row that no longer exists is reported as such rather than as success: RLS
 * makes "not yours" and "not there" indistinguishable here, and both mean the
 * user's edit did not land.
 */
export async function updateDraftAction(
  draftId: string,
  body: string,
): Promise<DraftResult> {
  const invalid = validateBody(body);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("drafts")
    .update({
      body,
      title: deriveTitle(body),
      updated_at: new Date().toISOString(),
    })
    .eq("id", draftId)
    .select("id")
    .maybeSingle();

  if (error) {
    if (isMissingDraftsTable(error)) return { ok: false, unavailable: true };
    console.error(writeErrorLogLine("drafts", "update", error));
    return { ok: false, error: describeWriteError(error, "Couldn't save that draft.") };
  }
  if (!data) return { ok: false, error: "That draft is no longer there." };

  revalidatePath("/library");
  return { ok: true, draftId: data.id };
}

/** Delete a draft — used by the Drafts list, and after a draft is resumed
 *  into the composer (a resumed draft has become the live draft; leaving the
 *  server copy behind would fork it on the next save). */
export async function deleteDraftAction(draftId: string): Promise<DraftResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("drafts").delete().eq("id", draftId);
  if (error) {
    if (isMissingDraftsTable(error)) return { ok: false, unavailable: true };
    console.error(writeErrorLogLine("drafts", "delete", error));
    return { ok: false, error: describeWriteError(error, "Couldn't delete that draft.") };
  }
  revalidatePath("/library");
  return { ok: true };
}

/** The full body of one draft, for resuming it into the composer. Selected by
 *  id only — RLS scopes it to the owner. */
export async function getDraftBodyAction(
  draftId: string,
): Promise<{ ok: boolean; body?: string; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("drafts")
    .select("body")
    .eq("id", draftId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "That draft is no longer there." };
  return { ok: true, body: data.body };
}

/** Next page of drafts for the Drafts view's "Load more".
 *
 *  Takes the raw searchParams rather than a LibraryFilter: the filter has to be
 *  re-parsed server-side anyway (a client could send anything), and reusing
 *  `parseLibraryParams` means page 2 is narrowed by exactly the same rules as
 *  page 1 — the way "Load more" silently drops a filter otherwise. */
export async function fetchDraftsPageAction(
  params: Record<string, string | string[] | undefined>,
  cursor: string,
): Promise<{ ok: boolean; cards?: DraftCard[]; nextCursor?: string | null; error?: string }> {
  const supabase = await createClient();
  try {
    const { cards, nextCursor } = await queryDraftsPage(
      supabase,
      parseLibraryParams(params),
      cursor,
    );
    return { ok: true, cards, nextCursor };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't load more." };
  }
}

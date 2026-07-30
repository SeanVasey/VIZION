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

function validate(v: DraftInput): string | null {
  if (!v.body.trim()) return "Nothing to save.";
  if (v.body.length > MAX_BODY) return "That draft is too long to save.";
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

/** Next page of drafts for the Drafts view's "Load more". */
export async function fetchDraftsPageAction(
  cursor: string,
): Promise<{ ok: boolean; cards?: DraftCard[]; nextCursor?: string | null; error?: string }> {
  const supabase = await createClient();
  try {
    const { cards, nextCursor } = await queryDraftsPage(supabase, cursor);
    return { ok: true, cards, nextCursor };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't load more." };
  }
}

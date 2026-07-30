import "server-only";
import type { createClient } from "@/lib/supabase/server";
import {
  LIBRARY_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
} from "@/lib/library/paging";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * PostgREST's code for "that relation isn't in the schema cache" — what every
 * read here returns until `20260730000000_drafts.sql` is applied.
 *
 * The migration lands by hand (owner applies it), so there is a window where
 * the client knows about drafts and the database does not. In that window the
 * Drafts view must render "No drafts" — an empty feature — rather than the
 * library's "Couldn't load your library" alert, which would be both wrong and
 * alarming about data that is fine. Every other error still throws: a real
 * failure must not be laundered into "you have nothing saved", which is the
 * exact mistake `library/page.tsx` already guards against in its own catch.
 */
const UNDEFINED_TABLE = "PGRST205";

export function isMissingDraftsTable(error: { code?: string | null } | null): boolean {
  return error?.code === UNDEFINED_TABLE;
}

/** One Drafts-list row. Bodies are NOT fetched — the list renders the title
 *  and preview only, and resuming fetches the body by id. */
export interface DraftCard {
  id: string;
  title: string;
  preview: string;
  target_model: string;
  mode: string;
  thinking_level: string | null;
  created_at: string;
  updated_at: string;
}

/** How much of the body the list row shows. */
const PREVIEW_CHARS = 160;

interface DraftRow {
  id: string;
  title: string;
  body: string;
  target_model: string;
  mode: string;
  thinking_level: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One page of drafts, newest-updated first, keyset-paginated on
 * (updated_at, id) — the same shape and page size as the library page, so the
 * Drafts view's "Load more" behaves identically.
 *
 * `body` is selected because the preview is derived from it; only the first
 * PREVIEW_CHARS survive into the card, so no full body crosses into the client
 * payload for a list of 30.
 */
export async function queryDraftsPage(
  supabase: Supabase,
  cursorRaw?: string,
): Promise<{ cards: DraftCard[]; nextCursor: string | null; unavailable: boolean }> {
  let q = supabase
    .from("drafts")
    .select("id, title, body, target_model, mode, thinking_level, created_at, updated_at");

  const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
  if (cursor) {
    q = q.or(
      `updated_at.lt.${cursor.value},and(updated_at.eq.${cursor.value},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await q
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(LIBRARY_PAGE_SIZE + 1);

  if (error) {
    if (isMissingDraftsTable(error)) {
      return { cards: [], nextCursor: null, unavailable: true };
    }
    throw new Error(error.message);
  }

  const rows = (data ?? []) as unknown as DraftRow[];
  const page = rows.slice(0, LIBRARY_PAGE_SIZE);
  const cards: DraftCard[] = page.map((row) => ({
    id: row.id,
    title: row.title,
    preview: row.body.slice(0, PREVIEW_CHARS),
    target_model: row.target_model,
    mode: row.mode,
    thinking_level: row.thinking_level,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > LIBRARY_PAGE_SIZE && last
      ? encodeCursor(last.updated_at, last.id)
      : null;
  return { cards, nextCursor, unavailable: false };
}

/** Count of the user's drafts, for the view's facet badge. Capped: the badge
 *  is a rough "how many", not a total, and an unbounded count on every
 *  library render is not worth it. `null` = unavailable (migration pending). */
export async function queryDraftCount(supabase: Supabase): Promise<number | null> {
  const { data, error } = await supabase.from("drafts").select("id").limit(200);
  if (error) return null;
  return (data ?? []).length;
}

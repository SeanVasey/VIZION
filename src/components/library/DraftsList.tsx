"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { useUIStore } from "@/stores/ui";
import { THINKING_LEVELS } from "@/lib/constants";
import type { ModeId, TargetModelId, ThinkingLevel } from "@/lib/constants";
import { MODEL_LABELS } from "@/lib/library/model-labels";
import { Sheet } from "@/components/ui/Sheet";
import {
  deleteDraftAction,
  fetchDraftsPageAction,
  getDraftBodyAction,
  updateDraftAction,
} from "@/lib/drafts/actions";
import type { DraftCard } from "@/lib/drafts/queries";
import { relativeTime } from "@/lib/library/util";
import { libraryHref, type LibraryFilter } from "@/lib/library/paging";

const LEVELS = new Set<string>(THINKING_LEVELS);

const TRANSPORT_FAILURE = "Couldn't reach the server — check your connection.";

/**
 * Run a server action so a TRANSPORT failure becomes a value, not a throw.
 *
 * A server action returns `{ ok: false }` for errors it can describe, but it
 * REJECTS when the request itself fails — a dropped connection, a 500 from the
 * edge. An uncaught rejection inside `startTransition` propagates to the route
 * error boundary, which unmounts this component; for the edit sheet that means
 * the user's unsaved text is discarded by the very path that exists to preserve
 * it. Every awaited action here goes through this.
 *
 * The fallback is passed in rather than synthesised, so each call site states
 * the shape of its own failure and the types line up exactly.
 */
async function settle<T>(work: Promise<T>, onTransportFailure: T): Promise<T> {
  try {
    return await work;
  } catch {
    return onTransportFailure;
  }
}

/**
 * The Drafts view of the library — unfinished composer state saved to the
 * account, newest-edited first.
 *
 * Resuming is deliberately a MOVE, not a copy: the draft's state is written
 * into the composer and the server row is deleted. Keeping both would fork the
 * same work in two places, and the next save would have to guess which one the
 * user meant. Delete-after-load ordering matters — the body is fetched first,
 * so a failed read leaves the draft where it was rather than losing it.
 *
 * `unavailable` renders a distinct message: the drafts migration is applied by
 * hand, so between the client deploy and that migration this view exists with
 * no table behind it. "Nothing saved" would be a lie about data the user may
 * well have; the alternative — an error alert — would be alarming about a
 * system that is merely incomplete.
 */
export function DraftsList({
  initialCards,
  nextCursor,
  unavailable,
  filter,
}: {
  initialCards: DraftCard[];
  nextCursor: string | null;
  unavailable: boolean;
  /** Re-sent with "Load more" so page 2 is narrowed exactly like page 1 — the
   *  filter silently applying to the first page only is the classic bug here. */
  filter: LibraryFilter;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const setEditorDraft = useUIStore((s) => s.setEditorDraft);
  const setTargetModel = useUIStore((s) => s.setTargetModel);
  const setActiveMode = useUIStore((s) => s.setActiveMode);
  const setThinkingLevel = useUIStore((s) => s.setThinkingLevel);

  const [extra, setExtra] = useState<DraftCard[]>([]);
  /**
   * The keyset cursor, but ONLY once we have paged past the server's first page.
   *
   * `undefined` means "not paged yet — use the `nextCursor` prop", which is the
   * boundary of whatever page 1 the server most recently rendered. Holding the
   * prop in `useState` instead looked equivalent and was not: `useState` does not
   * re-initialise when `router.refresh()` supplies a new prop, so after an edit
   * the cursor would still describe the PRE-edit page boundary. The edited row
   * moves to the top of page 1 and displaces the old last row onto page 2, so a
   * stale cursor starts after that displaced row and skips it permanently.
   *
   * `null` (as opposed to undefined) is a real answer: paged, and there is no
   * next page.
   */
  const [pagedCursor, setPagedCursor] = useState<string | null | undefined>(undefined);
  const cursor = pagedCursor === undefined ? nextCursor : pagedCursor;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmFor, setConfirmFor] = useState<DraftCard | null>(null);
  const [pending, startAction] = useTransition();
  /**
   * A SEPARATE transition, entered synchronously, that owns `router.refresh()`.
   *
   * `startAction` runs an async callback, and once that callback has awaited,
   * React is no longer inside the transition scope — so a `router.refresh()`
   * called after the await is not attached to any transition and `pending` can
   * go false while the refreshed props are still in flight. In that window
   * `cursor` falls back to the still-OLD `nextCursor` prop, and paging from it
   * re-creates the very skip the derivation was added to prevent.
   *
   * Calling refresh inside its own SYNCHRONOUS transition callback attaches it
   * properly, so `refreshing` stays true until the new server render commits.
   * Deadlock-free by construction: React always settles a transition, even if
   * the refreshed props turn out identical — unlike gating on a prop actually
   * changing, which would hide "Load more" forever when an edit happens not to
   * move the page boundary.
   */
  const [refreshing, startRefresh] = useTransition();

  /**
   * In-place edit state. `body` is null until the full text has been fetched —
   * the list row only holds a 160-character preview, and opening an editor
   * seeded with a truncation would silently destroy the rest on save.
   */
  const [editing, setEditing] = useState<DraftCard | null>(null);
  const [editBody, setEditBody] = useState<string | null>(null);
  /** `updated_at` of the body the editor is showing, used as the save
   *  precondition. Taken from the FETCH, not from the list row — the row's
   *  timestamp can already be stale when the editor opens, and conditioning on
   *  that would reject a save against a body the user never saw. */
  const [editBaseVersion, setEditBaseVersion] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  /** Tracked separately from the shared `pending`. Opening the sheet also runs a
   *  transition (to fetch the body), and reusing `pending` for the save button
   *  made it read "Saving…" while it was in fact still loading — the wrong word
   *  for the wrong operation. */
  const [savingEdit, setSavingEdit] = useState(false);

  function openEditor(card: DraftCard) {
    setEditing(card);
    setEditBody(null);
    setEditBaseVersion(null);
    setEditError(null);
    startAction(async () => {
      const got = await settle(getDraftBodyAction(card.id), {
        ok: false,
        error: TRANSPORT_FAILURE,
      });
      if (!got.ok || got.body === undefined || got.updatedAt === undefined) {
        setEditError(got.error ?? "Couldn't open that draft.");
        return;
      }
      setEditBody(got.body);
      setEditBaseVersion(got.updatedAt);
    });
  }

  function closeEditor() {
    setEditing(null);
    setEditBody(null);
    setEditBaseVersion(null);
    setEditError(null);
  }

  function saveEdit() {
    if (!editing || editBody === null || editBaseVersion === null) return;
    // Set OUTSIDE the transition, on purpose. Inside `startAction` this is a
    // transition-priority update, so a discrete event — Escape, a scrim tap —
    // can be handled while `savingEdit` is still false, and the dismissal guard
    // reads the stale value and lets the sheet close mid-save. Setting it here
    // commits before the async work starts.
    setSavingEdit(true);
    startAction(async () => {
      const res = await settle(updateDraftAction(editing.id, editBody, editBaseVersion), {
        ok: false,
        error: TRANSPORT_FAILURE,
      }).finally(() => setSavingEdit(false));
      if (!res.ok) {
        // Stay open with the text intact — closing would throw away the edit
        // the user just failed to save.
        setEditError(
          res.unavailable
            ? "Drafts aren't set up on the server yet."
            : (res.error ?? "Couldn't save that draft."),
        );
        return;
      }
      closeEditor();
      toast({ text: "Draft updated" });
      // Collapse back to the server's first page. An edit bumps `updated_at`,
      // which moves the draft to the top of a list ordered by it — so the
      // keyset cursor that produced pages 2+ no longer describes the same
      // sequence, and a client-accumulated page would show the pre-edit text
      // while the refreshed page 1 shows the new one. The same row, twice,
      // disagreeing with itself.
      setExtra([]);
      // Back to "not paged": the cursor comes from the refreshed prop, so it
      // describes the page the server just rendered rather than the one it
      // rendered before this edit reordered the list.
      setPagedCursor(undefined);
      startRefresh(() => router.refresh());
    });
  }

  const cards = [...initialCards, ...extra];

  function resume(card: DraftCard) {
    startAction(async () => {
      const got = await settle(getDraftBodyAction(card.id), {
        ok: false,
        error: TRANSPORT_FAILURE,
      });
      if (!got.ok || got.body === undefined) {
        toast({ text: got.error ?? "Couldn't open that draft.", tone: "error" });
        return;
      }
      // Restore the whole composer state, not just the text — the draft was
      // written against a specific target and mode.
      setEditorDraft(got.body);
      setTargetModel(card.target_model as TargetModelId);
      setActiveMode(card.mode as ModeId);
      setThinkingLevel(
        card.target_model as TargetModelId,
        card.thinking_level && LEVELS.has(card.thinking_level)
          ? (card.thinking_level as ThinkingLevel)
          : null,
      );
      // The draft is now the live composer draft; drop the server copy so the
      // same work does not exist twice. A failure here is not fatal — the body
      // is already in the composer — but it must not pass silently, or the user
      // ends up with the same work in two places and no idea why.
      const dropped = await settle(deleteDraftAction(card.id), {
        ok: false,
        error: TRANSPORT_FAILURE,
      });
      if (!dropped.ok) {
        toast({
          text: "Opened the draft, but it's still saved in your library.",
          tone: "error",
        });
      }
      router.push("/enhance");
    });
  }

  function remove(card: DraftCard) {
    startAction(async () => {
      const res = await settle(deleteDraftAction(card.id), {
        ok: false,
        error: TRANSPORT_FAILURE,
      });
      if (!res.ok) {
        toast({ text: res.error ?? "Couldn't delete that draft.", tone: "error" });
        return;
      }
      setExtra((xs) => xs.filter((x) => x.id !== card.id));
      setConfirmFor(null);
      toast({ text: "Draft deleted" });
      startRefresh(() => router.refresh());
    });
  }

  function loadMore() {
    // `refreshing` means the props this cursor came from are being replaced.
    if (!cursor || refreshing) return;
    startAction(async () => {
      // Derive the params from the same helper that builds the URL, so the
      // action re-parses precisely the filter this view is showing.
      const params = Object.fromEntries(
        new URL(libraryHref(filter), "http://x").searchParams.entries(),
      );
      const res = await settle(fetchDraftsPageAction(params, cursor), {
        ok: false,
        error: TRANSPORT_FAILURE,
      });
      if (!res.ok || !res.cards) {
        setLoadError(res.error ?? "Couldn't load more drafts.");
        return;
      }
      setLoadError(null);
      setExtra((xs) => [...xs, ...res.cards!]);
      // `null`, not undefined — an exhausted list must not fall back to the
      // prop and re-offer "Load more" for a page that returned nothing.
      setPagedCursor(res.nextCursor ?? null);
    });
  }

  if (unavailable) {
    return (
      <div className="glass rounded-2xl p-6 text-center">
        <p className="font-display text-balance text-xl tracking-wide text-text">
          Drafts aren&apos;t set up yet
        </p>
        <p className="font-body mt-2 text-sm text-muted">
          This device still keeps your in-progress prompt — nothing has been lost.
        </p>
      </div>
    );
  }

  if (cards.length === 0) {
    // "No drafts" while a search is active would read as "you have none",
    // which is a different and possibly false claim.
    const narrowed = Boolean(filter.q || filter.model || filter.mode);
    return (
      <div className="glass rounded-2xl p-6 text-center">
        <p className="font-display text-balance text-xl tracking-wide text-text">
          {narrowed ? "No drafts match" : "No drafts"}
        </p>
        <p className="font-body mt-2 text-sm text-muted">
          {narrowed
            ? "Try a different search, or clear the filter to see all your drafts."
            : "Start a new prompt with the + button and choose Save draft to keep an unfinished one here."}
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-3">
        {cards.map((card) => (
          <li key={card.id} className="glass rounded-2xl">
            <div className="flex items-start gap-2 p-4">
              <button
                type="button"
                onClick={() => resume(card)}
                disabled={pending}
                className="min-w-0 flex-1 text-left disabled:opacity-50"
              >
                <p className="font-body truncate text-sm text-text">{card.title}</p>
                {card.preview.trim() !== card.title.trim() && (
                  <p className="font-body mt-1 line-clamp-2 text-xs text-muted">
                    {card.preview}
                  </p>
                )}
                <p className="font-body mt-2 flex flex-wrap items-center gap-x-2 text-xs text-silver">
                  <span>{MODEL_LABELS.get(card.target_model) ?? card.target_model}</span>
                  <span aria-hidden="true">·</span>
                  <span className="capitalize">{card.mode}</span>
                  <span aria-hidden="true">·</span>
                  <span>Edited {relativeTime(card.updated_at)}</span>
                </p>
              </button>
              <button
                type="button"
                onClick={() => openEditor(card)}
                disabled={pending}
                aria-label={`Edit draft: ${card.title}`}
                className="tap-44 shrink-0 text-silver transition-colors hover:text-accent disabled:opacity-50"
              >
                {/* Pencil — 1.5px stroke, rounded joins (style-guide §1.4). */}
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
                  <path
                    d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setConfirmFor(card)}
                disabled={pending}
                aria-label={`Delete draft: ${card.title}`}
                className="tap-44 shrink-0 text-silver transition-colors hover:text-flare disabled:opacity-50"
              >
                {/* 1.5px stroke, rounded joins (style-guide §1.4). */}
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
                  <path
                    d="M5 7h14M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M7 7l.8 12A1.5 1.5 0 0 0 9.3 20.5h5.4a1.5 1.5 0 0 0 1.5-1.5L17 7"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </li>
        ))}
      </ul>

      {loadError && (
        <p role="alert" className="font-body mt-3 text-sm text-flare">
          {loadError}
        </p>
      )}

      {/* Hidden, not merely disabled, while a refresh is in flight: the cursor
          on offer is the pre-refresh boundary, and a disabled-looking button
          still invites a click the instant the flag clears. */}
      {cursor && !refreshing && (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          className="btn-secondary mx-auto mt-4 flex min-h-[44px] items-center justify-center px-5 text-sm disabled:opacity-50"
        >
          {pending ? "Loading…" : "Load more"}
        </button>
      )}

      <Sheet
        open={editing !== null}
        // Escape, the scrim and the Close button all route here, and disabling
        // the footer Cancel button covered none of them. Dismissing mid-save
        // ran closeEditor(), which cleared the edited text — so a save that then
        // failed wrote its error into a closed sheet and the edit was gone,
        // defeating the whole point of keeping it on failure.
        onClose={() => {
          if (!savingEdit) closeEditor();
        }}
        title="Edit draft"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveEdit}
              // Disabled until the full body has loaded: saving `null` would be
              // saving nothing, and saving the preview would truncate the draft.
              disabled={
                savingEdit ||
                editBody === null ||
                editBaseVersion === null ||
                editBody.trim() === ""
              }
              className="btn-laser flex min-h-[44px] flex-1 items-center justify-center px-5 text-sm disabled:opacity-50"
            >
              {savingEdit ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={closeEditor}
              disabled={savingEdit}
              className="btn-secondary flex min-h-[44px] items-center justify-center px-5 text-sm disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        }
      >
        {editBody === null ? (
          <p className="font-body text-sm text-muted">
            {editError ?? "Loading the full draft…"}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <label htmlFor="draft-edit-body" className="sr-only">
              Draft text
            </label>
            {/* readOnly while saving, not disabled: the request has already
                captured this value, so keystrokes typed after Save would be
                discarded by closeEditor() on success while the server kept the
                earlier snapshot — lost with no error. readOnly rather than
                disabled keeps the text readable and selectable, and keeps focus,
                for what is normally a brief moment. */}
            <textarea
              id="draft-edit-body"
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              readOnly={savingEdit}
              rows={10}
              className="font-body w-full resize-y rounded-lg border border-hair bg-surface px-3 py-2 text-sm text-text placeholder:text-muted read-only:opacity-60 focus:outline-none"
            />
            <p className="font-body text-xs text-silver">
              Editing the text only — target model and mode stay as saved. Open the
              draft in the composer to change those.
            </p>
            {editError && (
              <p role="alert" className="font-body text-sm text-flare">
                {editError}
              </p>
            )}
          </div>
        )}
      </Sheet>

      <ConfirmSheet
        open={confirmFor !== null}
        onClose={() => setConfirmFor(null)}
        title="Delete this draft?"
        body="This removes the saved draft from your account. It can't be undone."
        confirmLabel="Delete draft"
        destructive
        onConfirm={() => confirmFor && remove(confirmFor)}
      />
    </>
  );
}

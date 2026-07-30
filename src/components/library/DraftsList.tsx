"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { useUIStore } from "@/stores/ui";
import { TARGET_MODELS, THINKING_LEVELS } from "@/lib/constants";
import type { ModeId, TargetModelId, ThinkingLevel } from "@/lib/constants";
import {
  deleteDraftAction,
  fetchDraftsPageAction,
  getDraftBodyAction,
} from "@/lib/drafts/actions";
import type { DraftCard } from "@/lib/drafts/queries";
import { relativeTime } from "@/lib/library/util";

const MODEL_LABEL = new Map(TARGET_MODELS.map((m) => [m.id, m.label]));
const LEVELS = new Set<string>(THINKING_LEVELS);

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
}: {
  initialCards: DraftCard[];
  nextCursor: string | null;
  unavailable: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const setEditorDraft = useUIStore((s) => s.setEditorDraft);
  const setTargetModel = useUIStore((s) => s.setTargetModel);
  const setActiveMode = useUIStore((s) => s.setActiveMode);
  const setThinkingLevel = useUIStore((s) => s.setThinkingLevel);

  const [extra, setExtra] = useState<DraftCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(nextCursor);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmFor, setConfirmFor] = useState<DraftCard | null>(null);
  const [pending, startAction] = useTransition();

  const cards = [...initialCards, ...extra];

  function resume(card: DraftCard) {
    startAction(async () => {
      const got = await getDraftBodyAction(card.id);
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
      const dropped = await deleteDraftAction(card.id);
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
      const res = await deleteDraftAction(card.id);
      if (!res.ok) {
        toast({ text: res.error ?? "Couldn't delete that draft.", tone: "error" });
        return;
      }
      setExtra((xs) => xs.filter((x) => x.id !== card.id));
      setConfirmFor(null);
      toast({ text: "Draft deleted" });
      router.refresh();
    });
  }

  function loadMore() {
    if (!cursor) return;
    startAction(async () => {
      const res = await fetchDraftsPageAction(cursor);
      if (!res.ok || !res.cards) {
        setLoadError(res.error ?? "Couldn't load more drafts.");
        return;
      }
      setLoadError(null);
      setExtra((xs) => [...xs, ...res.cards!]);
      setCursor(res.nextCursor ?? null);
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
    return (
      <div className="glass rounded-2xl p-6 text-center">
        <p className="font-display text-balance text-xl tracking-wide text-text">
          No drafts
        </p>
        <p className="font-body mt-2 text-sm text-muted">
          Start a new prompt with the + button and choose Save draft to keep an
          unfinished one here.
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
                  <span>{MODEL_LABEL.get(card.target_model as TargetModelId) ?? card.target_model}</span>
                  <span aria-hidden="true">·</span>
                  <span className="capitalize">{card.mode}</span>
                  <span aria-hidden="true">·</span>
                  <span>Edited {relativeTime(card.updated_at)}</span>
                </p>
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

      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          className="btn-secondary mx-auto mt-4 flex min-h-[44px] items-center justify-center px-5 text-sm disabled:opacity-50"
        >
          {pending ? "Loading…" : "Load more"}
        </button>
      )}

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

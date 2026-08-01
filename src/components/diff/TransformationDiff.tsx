"use client";

import { memo, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { PressableButton } from "@/components/ui/PressableButton";
import Link from "next/link";
import {
  MODE_LABEL,
  TARGET_DEVELOPER,
  type ModeId,
  type TargetModelId,
} from "@/lib/constants";
import type { EnhanceResponse } from "@/lib/enhance/use-enhance";
import { DeveloperIcon } from "@/components/models/DeveloperIcon";
import {
  countChangedSections,
  toHunks,
  assignHunks,
  applyDecisions,
} from "@/lib/enhance/diff";
import { EXPORTERS, type ExportData, type ExportFormat } from "@/lib/enhance/export";
import {
  TARGET_LABEL,
  isShapePreserving,
  type RefineKind,
} from "@/lib/providers/formatters";
import {
  savePromptAction,
  addVersionAction,
  logShareAction,
} from "@/lib/library/actions";
import { enqueueOutbox } from "@/lib/pwa/outbox";
import { useUIStore } from "@/stores/ui";
import { useCopy } from "@/components/ui/use-copy";
import { CheckMark } from "@/components/ui/glyphs";
import { InputSegments, OutputSegments, REMOVED_CLASS } from "@/components/diff/segments";
import { CompareSheet } from "@/components/diff/CompareSheet";

/** The original always starts collapsed (2026-07 product review): the improved
 *  prompt is the primary object, and on a phone even a short original pushes
 *  the rationale and actions down a screen. One tap reveals it. */
const ORIGINAL_STARTS_OPEN = false;

const REFINE_CHIPS: { kind: RefineKind; label: string }[] = [
  { kind: "shorter", label: "Make shorter" },
  { kind: "detail", label: "More detail" },
  { kind: "tone", label: "Keep my tone" },
];

/**
 * The enhance result view (product-spec §1.1, §4.1), mobile-first: Enhanced
 * leads, Copy + Use are the primary actions, the original collapses for long
 * prompts, the full diff read lives in the Compare sheet, and Polish offers
 * per-change accept/reject. `onUse`/`onRefine` are wired by the composer.
 */
function TransformationDiffImpl({
  input,
  mode,
  target,
  result,
  refined = false,
  refinePending = false,
  onUse,
  onRefine,
  onAnswer,
}: {
  input: string;
  mode: ModeId;
  target: TargetModelId;
  result: EnhanceResponse;
  /** True when this result came from a refinement pass — the diff's input
   *  side is then the PREVIOUS result, not the author's original. */
  refined?: boolean;
  refinePending?: boolean;
  onUse?: (text: string) => void;
  onRefine?: (kind: RefineKind, currentOutput: string) => void;
  /** Clarify's answered re-run. Absent = the questions card isn't offered
   *  (the library's re-enhance has no follow-up loop). */
  onAnswer?: (questions: string[], answers: string[]) => void;
}) {
  const { copied, copy } = useCopy();
  // Recorded on the queued item so an offline save replayed later cannot land
  // in a different account on a shared device — IndexedDB is origin-scoped,
  // and the replay resolves the owner from whoever is signed in at flush time.
  // `?? ""` is defensive only (the authed layout hydrates this before any
  // interaction) and fails CLOSED: an item with no owner is never replayed.
  const userId = useUIStore((s) => s.userId);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ promptId: string; title: string } | null>(
    null,
  );
  const [saving, startSave] = useTransition();
  const [compareOpen, setCompareOpen] = useState(false);

  // Sticky-actions gate: once the real Copy/Use row has scrolled out of view,
  // a compact copy of it rides the bottom of the viewport so the two primary
  // actions never require scrolling back up a long result (P0).
  const primaryActionsRef = useRef<HTMLDivElement | null>(null);
  const [primaryOffscreen, setPrimaryOffscreen] = useState(false);
  useEffect(() => {
    const row = primaryActionsRef.current;
    // IntersectionObserver is absent in jsdom; without it the sticky bar
    // simply never arms, which is the correct degradation.
    if (!row || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setPrimaryOffscreen(!entry?.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  // Per-change decisions (Polish only): hunk ids the user reverted.
  const [rejected, setRejected] = useState<ReadonlySet<number>>(new Set());
  // Clarify's answers, positional against result.questions.
  const [answers, setAnswers] = useState<string[]>([]);
  const answeredCount = answers.filter((a) => a.trim() !== "").length;
  // result.diff is null when the pair exceeded the server's diff budget
  // (PRI-001) — every consumer below degrades to plain text.
  const hunks = useMemo(() => (result.diff ? toHunks(result.diff) : []), [result]);
  const hunkOf = useMemo(
    () => (result.diff ? assignHunks(result.diff) : []),
    [result],
  );
  const reviewable = mode === "polish" && hunks.length > 0;

  /** What Copy/Use/Save/Share/export all consume — the output with the
   *  user's per-change decisions applied (identical to result.output when
   *  nothing was rejected or the mode isn't Polish). */
  const effectiveOutput = useMemo(
    () =>
      reviewable && rejected.size > 0 && result.diff
        ? applyDecisions(result.diff, rejected)
        : result.output,
    [reviewable, rejected, result],
  );

  // Web Share is absent on Firefox and on desktop Chrome outside Windows/
  // ChromeOS. Detected once rather than probed at click time, so the button
  // can be hidden instead of offered and then quietly doing something else.
  //
  // Detected during RENDER, which is normally a hydration hazard — the server
  // and the client would disagree about whether the button exists. It is safe
  // here for a specific reason: this component's only consumer renders it
  // behind `{view && ...}`, and `view` is client state set exclusively in a
  // mutation's onSuccess. There is no server render and no first-client
  // render, so there is no pair of markups to mismatch. If this component ever
  // gains a server-rendered consumer, THIS is the line that has to change —
  // move the detection into an effect behind a `mounted` flag.
  // (EnhanceComposer's `canPaste` uses the same detection and is safe for a
  // DIFFERENT reason: a `useState(false)` gate that is false on the server and
  // on the first client render alike. Don't assume the two are interchangeable.)
  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  /** The model that ACTUALLY ran. Under Auto the prop is only the fallback the
   *  client sent; the server reports what it resolved to. Everything
   *  user-facing or persisted reads this, so the library records the model
   *  that produced the text rather than the one nobody chose. */
  const effectiveTarget = result.resolvedTarget ?? target;

  // The diff's input side (= the author's original, or the previous result on
  // a refine run) — drives the collapse threshold and the word count honestly.
  const diffInput = useMemo(
    () =>
      (result.diff ?? [])
        .filter((s) => s.op !== "added")
        .map((s) => s.text)
        .join(""),
    [result],
  );
  const [showOriginal, setShowOriginal] = useState(ORIGINAL_STARTS_OPEN);

  // A new result (fresh run or refine) resets every per-result decision.
  useEffect(() => {
    setRejected(new Set());
    setSavedId(null);
    setQueued(false);
    setSaveError(null);
    setDuplicate(null);
    // `copied` self-clears on its own timer inside useCopy.
    setCompareOpen(false);
    setShowOriginal(ORIGINAL_STARTS_OPEN);
  }, [result]);

  const changes = result.diff ? countChangedSections(result.diff) : null;
  const keptCount = hunks.length - rejected.size;
  const originalLabel = refined ? "previous result" : "original";
  const originalWords =
    diffInput.trim() === "" ? 0 : diffInput.trim().split(/\s+/).length;

  function save() {
    setSaveError(null);
    const payload = {
      input,
      output: effectiveOutput,
      rationale: result.rationale,
      mode,
      target: effectiveTarget,
      modelUsed: result.modelUsed,
      tokenIn: result.tokenIn,
      tokenOut: result.tokenOut,
      ...(result.title ? { title: result.title } : {}),
    };
    startSave(async () => {
      // Offline → queue to the outbox; it flushes on reconnect/foreground.
      // "Queued" is claimed only when the queue write actually landed AND had
      // an owner to land under (SW-001/SW-002) — a rejecting IndexedDB put or
      // a pre-hydration save must say so, not promise a sync that can't come.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        if (userId && (await enqueueOutbox(userId, "save-prompt", payload))) {
          setQueued(true);
        } else {
          setSaveError(
            "Couldn't queue this save on this device — copy the text before leaving.",
          );
        }
        return;
      }
      try {
        const res = await savePromptAction(payload);
        if (res.ok && res.promptId) setSavedId(res.promptId);
        else if (res.duplicate) setDuplicate(res.duplicate);
        else setSaveError(res.error ?? "Couldn't save.");
      } catch {
        // Gated on being offline (the GenerateSheet shape): an ONLINE server
        // failure is an error to report, not a queue to promise.
        if (
          typeof navigator !== "undefined" &&
          navigator.onLine === false &&
          userId &&
          (await enqueueOutbox(userId, "save-prompt", payload))
        ) {
          setQueued(true);
        } else {
          setSaveError("Couldn't save — try again.");
        }
      }
    });
  }

  /** Duplicate resolution: append to the existing prompt instead. */
  function saveAsNewVersion() {
    if (!duplicate) return;
    setSaveError(null);
    const dup = duplicate;
    startSave(async () => {
      const res = await addVersionAction(dup.promptId, {
        input,
        output: effectiveOutput,
        rationale: result.rationale,
        mode,
        target: effectiveTarget,
        modelUsed: result.modelUsed,
        tokenIn: result.tokenIn,
        tokenOut: result.tokenOut,
      });
      if (res.ok && res.promptId) {
        setSavedId(res.promptId);
        setDuplicate(null);
      } else {
        setSaveError(res.error ?? "Couldn't save the new version.");
      }
    });
  }

  const exportData: ExportData = {
    input,
    output: effectiveOutput,
    rationale: result.rationale,
    mode,
    target: effectiveTarget,
    modelUsed: result.modelUsed,
  };

  async function copyOutput() {
    await copy(effectiveOutput);
  }

  async function share() {
    const text = effectiveOutput;
    try {
      await navigator.share({ title: "VIZ(IO)N prompt", text });
      // The activity feed advertises "shared" events — log them when the
      // shared prompt is saved (the action existed, unwired). Swallow a
      // failed log so it never becomes an unhandled rejection.
      if (savedId) void logShareAction(savedId).catch(() => {});
    } catch (e) {
      // Dismissing the share sheet rejects with AbortError, and that is the
      // most common outcome of tapping Share. Copying the prompt because the
      // user declined to share it would be the very thing this button was
      // just fixed for — a surprise clipboard write with "Copied ✓" flashing
      // on the OTHER control. Only a genuine failure falls back.
      if (e instanceof Error && e.name === "AbortError") return;
      await copyOutput();
    }
  }

  function download(format: ExportFormat) {
    const exp = EXPORTERS[format];
    const blob = new Blob([exp.render(exportData)], { type: exp.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vizion-${mode}.${exp.ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Enhance result">
      {/* 1 · Enhanced — the primary object, first. */}
      <div className="glass result-shimmer rounded-2xl p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-body text-xs uppercase tracking-wider text-silver">
            Enhanced
          </p>
          <div className="flex items-center gap-2.5">
            <p className="font-body text-xs text-accent">
              {reviewable && rejected.size > 0
                ? `${keptCount}/${hunks.length} changes kept`
                : changes === null
                  ? "too long to diff — showing plain text"
                  : `${changes} changed section${changes === 1 ? "" : "s"}`}
            </p>
            {/* Quick copy — a 44px tap target that doesn't inflate the header row. */}
            <PressableButton
              onClick={copyOutput}
              aria-label={copied ? "Copied" : "Copy enhanced prompt"}
              className="-my-2 -mr-1.5 flex h-11 w-11 items-center justify-center rounded-full text-silver hover:text-chalk focus-visible:text-chalk"
            >
              {copied ? (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-5 w-5 text-accent"
                >
                  <path
                    d="M20 6L9 17l-5-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
                  <rect
                    x="9"
                    y="9"
                    width="12"
                    height="12"
                    rx="2.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                  />
                  <path
                    d="M5.5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </PressableButton>
          </div>
        </div>
        {/* OUTPUT REGION: result text + diff tokens render in mono (JetBrains). */}
        <p className="mono whitespace-pre-wrap break-words text-sm text-chalk">
          {result.diff ? (
            <OutputSegments segments={result.diff} hunkOf={hunkOf} rejected={rejected} />
          ) : (
            effectiveOutput
          )}
        </p>
      </div>

      {/* 2 · Primary actions — Copy + Use, directly under the result. */}
      <div
        ref={primaryActionsRef}
        className={`grid gap-2 ${onUse ? "grid-cols-2" : "grid-cols-1"}`}
      >
        <button
          type="button"
          onClick={copyOutput}
          className="btn-laser flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-xl px-2 text-sm"
        >
          {copied ? (
            <span className="inline-flex items-center gap-1">
              Copied
              <CheckMark />
            </span>
          ) : (
            "Copy"
          )}
        </button>
        {onUse && (
          <button
            type="button"
            onClick={() => onUse(effectiveOutput)}
            className="btn-secondary flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-xl px-2 text-sm"
          >
            Use as draft
          </button>
        )}
      </div>

      {/* 3 · Refinement chips — follow-up passes seeded from this output. */}
      {onRefine && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {REFINE_CHIPS.map((chip) => (
            <button
              key={chip.kind}
              type="button"
              disabled={refinePending}
              onClick={() => onRefine(chip.kind, effectiveOutput)}
              className="tap-44 glass font-body rounded-full px-3.5 py-1.5 text-xs text-text hover-hair transition-colors disabled:opacity-50"
            >
              {chip.label}
            </button>
          ))}
          {refinePending && (
            <span className="font-body text-xs text-silver" role="status">
              Refining…
            </span>
          )}
        </div>
      )}

      {/* 4 · Per-change review — Polish only: accept/reject each edit. */}
      {reviewable && (
        <section
          aria-label="Review changes"
          className="rounded-2xl border border-hair p-4"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="font-body text-xs uppercase tracking-wider text-silver">
              Review changes ({hunks.length})
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setRejected(new Set())}
                disabled={rejected.size === 0}
                className="tap-44 font-body text-xs text-silver transition-colors hover:text-chalk disabled:opacity-50"
              >
                Keep all
              </button>
              <button
                type="button"
                onClick={() => setRejected(new Set(hunks.map((h) => h.index)))}
                disabled={rejected.size === hunks.length}
                className="tap-44 font-body text-xs text-silver transition-colors hover:text-chalk disabled:opacity-50"
              >
                Revert all
              </button>
            </div>
          </div>
          <ul className="flex flex-col divide-y divide-hair">
            {hunks.map((h) => {
              const isRejected = rejected.has(h.index);
              return (
                <li
                  key={h.index}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  {/* OUTPUT REGION: the change's before→after in mono. */}
                  <p className="mono min-w-0 break-words text-xs text-chalk">
                    <span className={REMOVED_CLASS}>
                      {h.removed.trim() === "" ? "∅" : h.removed}
                    </span>
                    <span aria-hidden="true" className="font-body px-1.5 text-silver">
                      →
                    </span>
                    {/* The rejected dim lands HERE, on the one span it is about
                        — the edit that will not apply — instead of on the <li>.
                        Row-wide it multiplied into every child: the struck
                        original fell to 1.85:1 (0.6 × the removed span's own
                        0.7), and the live Keep/Revert button was dimmed like a
                        disabled control while still being the row's only
                        action. --chalk survives 60% at 5.91:1 dark / 4.95:1
                        light, which --flare and --silver do not. */}
                    <span className={isRejected ? "opacity-60" : "text-accent"}>
                      {h.added.trim() === "" ? "∅" : h.added}
                    </span>
                  </p>
                  <button
                    type="button"
                    aria-pressed={!isRejected}
                    onClick={() =>
                      setRejected((prev) => {
                        const next = new Set(prev);
                        if (next.has(h.index)) next.delete(h.index);
                        else next.add(h.index);
                        return next;
                      })
                    }
                    className="glass font-body min-h-[44px] shrink-0 rounded-xl px-3 text-xs text-text hover-hair transition-colors"
                  >
                    {isRejected ? "Keep" : "Revert"}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* 5 · Secondary actions + export. */}
      <div className="flex flex-col gap-2">
        <div
          className={`grid gap-2 ${
            // Drop the TRACK with the button, not just the node — otherwise the
            // row keeps a dead third column and reads ragged against the
            // full-bleed export strip below it. Same pattern as the Copy/Use
            // row above, which switches cols on `onUse`.
            canShare ? "grid-cols-[1.35fr_1fr_1fr]" : "grid-cols-[1.35fr_1fr]"
          }`}
        >
          {savedId ? (
            <Link
              href={`/library/${savedId}`}
              className="flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-xl bg-pulse px-2 text-sm text-on-laser"
            >
              <span className="inline-flex items-center gap-1">
                Saved
                <CheckMark />
                — open
              </span>
            </Link>
          ) : queued ? (
            <span className="font-body flex min-h-[44px] items-center justify-center rounded-xl bg-amber px-2 text-center text-xs leading-snug text-on-laser">
              Queued — syncs when online
            </span>
          ) : (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="glass flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-xl px-2 text-sm text-text hover-hair transition-colors disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save to library"}
            </button>
          )}
          {/* Only where the platform actually has a share sheet. Without the
              gate this silently fell through to a clipboard write — a second
              button doing exactly what Copy does, one row away, with the
              "Copied ✓" flash landing on the OTHER button. Same policy the
              composer's paste pill already applies to its own capability. */}
          {canShare && (
            <button
              type="button"
              onClick={share}
              className="glass flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-xl px-2 text-sm text-text hover-hair transition-colors"
            >
              Share
            </button>
          )}
          {result.diff && (
            <button
              type="button"
              onClick={() => setCompareOpen(true)}
              className="glass flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-xl px-2 text-sm text-text hover-hair transition-colors"
            >
              Compare
            </button>
          )}
        </div>

        {/* Export strip — a micro-label cap plus equal format segments split by
            hairlines. The focus ring is INSET: the chassis' overflow-hidden
            (which squares the segment corners) would clip the default outer
            ring. */}
        <div className="glass flex items-stretch overflow-hidden rounded-xl">
          <span className="font-body flex items-center border-r border-hair px-3.5 text-[0.625rem] uppercase tracking-[0.18em] text-silver">
            Export
          </span>
          {(Object.keys(EXPORTERS) as ExportFormat[]).map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => download(fmt)}
              className="font-body min-h-[44px] flex-1 border-r border-hair text-xs uppercase tracking-wide text-silver transition-colors last:border-r-0 hover:text-chalk focus-visible:shadow-[inset_0_0_0_1px_var(--accent-ink)]"
            >
              {fmt}
            </button>
          ))}
        </div>
      </div>
      {/* Duplicate resolution — this exact content is already saved. */}
      {duplicate && !savedId && (
        <div
          className="rounded-2xl border border-hair p-4"
          role="status"
          aria-label="Duplicate detected"
        >
          <p className="font-body text-sm text-text">
            Already in your library as{" "}
            <span className="text-chalk">&ldquo;{duplicate.title}&rdquo;</span>.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link
              href={`/library/${duplicate.promptId}`}
              className="btn-secondary flex min-h-[44px] items-center justify-center rounded-xl px-3 text-sm"
            >
              Open
            </Link>
            <button
              type="button"
              onClick={saveAsNewVersion}
              disabled={saving}
              className="btn-laser flex min-h-[44px] items-center justify-center rounded-xl px-3 text-sm disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save as new version"}
            </button>
          </div>
        </div>
      )}
      {saveError && (
        <p className="font-body text-sm text-flare" role="alert">
          {saveError}
        </p>
      )}

      {/* 6 · Plain-language rationale — only when the model gave one. A
          salvaged run (recovered from a malformed envelope tail) says so
          honestly instead of rendering an empty card. */}
      <div className="rounded-2xl border border-hair p-4">
        {result.rationale.trim() !== "" ? (
          <>
            <p className="font-body mb-1 text-xs uppercase tracking-wider text-silver">
              What changed
            </p>
            <p className="font-body text-sm text-text">{result.rationale}</p>
          </>
        ) : result.salvaged ? (
          <p className="font-body text-sm text-silver" role="status">
            The model&apos;s explanation was cut off — the prompt above is complete.
          </p>
        ) : null}
        <p className="font-body mt-3 flex items-center gap-1.5 text-xs tabular-nums text-silver">
          <DeveloperIcon
            developer={TARGET_DEVELOPER[effectiveTarget]}
            className="h-3.5 w-3.5 shrink-0 text-accent"
          />
          {/* Routing provenance: an auto-routed run says which model it chose,
              because "Auto" alone tells the user nothing about what they just
              paid for. */}
          {result.resolvedTarget && (
            <span>Auto → {TARGET_LABEL[result.resolvedTarget]} · </span>
          )}
          {result.modelUsed} · {result.tokenIn}→{result.tokenOut} tok ·{" "}
          {result.usageEstimated ? "≈" : ""}${result.costUsd.toFixed(4)}
        </p>
      </div>

      {/* 7 · Assumptions — separated from the rationale (audit A4). */}
      {result.assumptions && result.assumptions.length > 0 && (
        <div className="rounded-2xl border border-hair p-4">
          <p className="font-body mb-1 text-xs uppercase tracking-wider text-silver">
            Assumptions made
          </p>
          <ul className="flex flex-col gap-1">
            {result.assumptions.map((a, i) => (
              <li key={i} className="font-body text-sm text-text">
                <span aria-hidden="true" className="text-accent">
                  ▸{" "}
                </span>
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 7b · Clarify's questions. The enhancement above is already the
          model's best effort — these are what it would ask to do better, not
          a blocker. Answering re-runs the ORIGINAL request with the answers
          attached, which is a second billed run, so the card says so rather
          than letting the button imply it's free.

          Deliberately no role="status": the result view already has exactly
          one and result-view.test.tsx queries it singular. */}
      {onAnswer && result.questions && result.questions.length > 0 && (
        <div className="rounded-2xl border border-hair p-4">
          <p className="font-body mb-1 text-xs uppercase tracking-wider text-silver">
            Questions that would sharpen this
          </p>
          <ul className="flex flex-col gap-3">
            {result.questions.map((q, i) => (
              <li key={i} className="flex flex-col gap-1">
                <label
                  htmlFor={`clarify-answer-${i}`}
                  className="font-body text-sm text-text"
                >
                  <span aria-hidden="true" className="text-accent">
                    ▸{" "}
                  </span>
                  {q}
                </label>
                <input
                  id={`clarify-answer-${i}`}
                  type="text"
                  value={answers[i] ?? ""}
                  onChange={(e) =>
                    setAnswers((prev) => {
                      const next = [...prev];
                      next[i] = e.target.value;
                      return next;
                    })
                  }
                  placeholder="Your answer (optional)"
                  className="glass font-body w-full rounded-xl bg-transparent px-3 py-2.5 text-base text-text placeholder:text-muted focus:outline-none"
                />
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={refinePending || answeredCount === 0}
            onClick={() => onAnswer(result.questions!, answers)}
            className="btn-laser font-body mt-3 flex min-h-[44px] w-full items-center justify-center rounded-xl px-4 text-sm disabled:opacity-60"
          >
            {refinePending ? "Re-running…" : "Answer & re-run"}
          </button>
          <p className="font-body mt-2 text-xs text-silver">
            {answeredCount === 0
              ? "Answer at least one question to re-run."
              : "Re-runs the original prompt with your answers — a second billed run."}
          </p>
        </div>
      )}

      {/* 8 · Destination-specific changes — or the honest line for the
          shape-preserving modes, where the destination affects routing/cost
          only and nothing in the output is destination-formatted. */}
      {result.targetNotes ? (
        <div className="rounded-2xl border border-hair p-4">
          <p className="font-body mb-1 text-xs uppercase tracking-wider text-silver">
            For {TARGET_LABEL[effectiveTarget]}
          </p>
          <p className="font-body text-sm text-text">{result.targetNotes}</p>
        </div>
      ) : isShapePreserving(mode) ? (
        <p className="font-body text-center text-xs text-silver">
          {MODE_LABEL[mode]} keeps your prompt&apos;s shape —{" "}
          {TARGET_LABEL[effectiveTarget]} ran the rewrite, but no{" "}
          {TARGET_LABEL[effectiveTarget]}-specific formatting was applied.
        </p>
      ) : null}

      {/* 9 · Original — collapsed by default for long prompts. */}
      <div>
        <button
          type="button"
          aria-expanded={showOriginal}
          onClick={() => setShowOriginal((v) => !v)}
          className="tap-44 font-body flex items-center gap-1.5 text-xs text-silver transition-colors hover:text-chalk"
        >
          <span
            aria-hidden="true"
            className={`inline-block transition-transform ${showOriginal ? "rotate-90" : ""}`}
          >
            ▸
          </span>
          {showOriginal ? `Hide ${originalLabel}` : `Show ${originalLabel}`} (
          {originalWords} word{originalWords === 1 ? "" : "s"})
        </button>
        {showOriginal && (
          <div className="mt-2 rounded-2xl border border-hair bg-[var(--scrim-panel)] p-4">
            <p className="font-body mb-2 text-xs uppercase tracking-wider text-silver">
              {refined ? "Previous result" : "Input"}
            </p>
            {/* OUTPUT REGION: the input body renders in mono; removed tokens
                are dimmed + struck — equal + removed reconstructs it losslessly. */}
            <p className="mono whitespace-pre-wrap break-words text-sm text-silver">
              {result.diff ? <InputSegments segments={result.diff} /> : input}
            </p>
          </div>
        )}
      </div>

      {/* Sticky primary actions — armed only once the real row is off-screen,
          so short results never grow a second copy of their own buttons.
          `sticky` (not `fixed`) keeps it inside this result's flow: it can
          never overlay another screen, and it clears the bottom nav. The
          entry animation rests at its final frame, so the global
          reduced-motion collapse leaves it correctly visible. */}
      {primaryOffscreen && (
        <div
          className="sheet-in glass-chrome sticky z-30 -mx-1 flex items-center gap-2 rounded-2xl px-2 py-2"
          style={{
            bottom: "calc(var(--bottom-nav-h) + env(safe-area-inset-bottom) + var(--float-gap))",
          }}
        >
          <button
            type="button"
            onClick={copyOutput}
            className="btn-laser flex min-h-[44px] flex-1 items-center justify-center whitespace-nowrap rounded-xl px-2 text-sm"
          >
            {copied ? (
              <span className="inline-flex items-center gap-1">
                Copied
                <CheckMark />
              </span>
            ) : (
              "Copy"
            )}
          </button>
          {onUse && (
            <button
              type="button"
              onClick={() => onUse(effectiveOutput)}
              className="btn-secondary flex min-h-[44px] flex-1 items-center justify-center whitespace-nowrap rounded-xl px-2 text-sm"
            >
              Use as draft
            </button>
          )}
        </div>
      )}

      {result.diff && (
        <CompareSheet
          open={compareOpen}
          onClose={() => setCompareOpen(false)}
          diff={result.diff}
          refined={refined}
          hunkOf={hunkOf}
          rejected={rejected}
        />
      )}
    </section>
  );
}

/**
 * Memoized: the composer re-renders on every keystroke and every SSE flush, but
 * this view reads the SUBMITTED snapshot (input+mode+target) and stable-identity
 * callbacks, so it should reconcile only when the result itself changes
 * (PERF-003). The composer hoists onUse/onRefine/onAnswer into useCallback so
 * this memo actually holds.
 */
export const TransformationDiff = memo(TransformationDiffImpl);

"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
import { savePromptAction, logShareAction } from "@/lib/library/actions";
import { enqueueOutbox } from "@/lib/pwa/outbox";
import { useToast } from "@/components/ui/Toast";
import { InputSegments, OutputSegments } from "@/components/diff/segments";
import { CompareSheet } from "@/components/diff/CompareSheet";

/** Inputs longer than this start with the original collapsed (mobile-first:
 *  the improved prompt is the primary object, not the diff diagnostics). */
const COLLAPSE_THRESHOLD_CHARS = 400;

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
export function TransformationDiff({
  input,
  mode,
  target,
  result,
  refined = false,
  refinePending = false,
  onUse,
  onRefine,
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
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [compareOpen, setCompareOpen] = useState(false);

  // Per-change decisions (Polish only): hunk ids the user reverted.
  const [rejected, setRejected] = useState<ReadonlySet<number>>(new Set());
  const hunks = useMemo(() => toHunks(result.diff), [result]);
  const hunkOf = useMemo(() => assignHunks(result.diff), [result]);
  const reviewable = mode === "polish" && hunks.length > 0;

  /** What Copy/Use/Save/Share/export all consume — the output with the
   *  user's per-change decisions applied (identical to result.output when
   *  nothing was rejected or the mode isn't Polish). */
  const effectiveOutput = useMemo(
    () =>
      reviewable && rejected.size > 0
        ? applyDecisions(result.diff, rejected)
        : result.output,
    [reviewable, rejected, result],
  );

  // The diff's input side (= the author's original, or the previous result on
  // a refine run) — drives the collapse threshold and the word count honestly.
  const diffInput = useMemo(
    () =>
      result.diff
        .filter((s) => s.op !== "added")
        .map((s) => s.text)
        .join(""),
    [result],
  );
  const [showOriginal, setShowOriginal] = useState(
    diffInput.length <= COLLAPSE_THRESHOLD_CHARS,
  );

  // A new result (fresh run or refine) resets every per-result decision.
  useEffect(() => {
    setRejected(new Set());
    setSavedId(null);
    setQueued(false);
    setSaveError(null);
    setCopied(false);
    setCompareOpen(false);
    setShowOriginal(
      result.diff
        .filter((s) => s.op !== "added")
        .reduce((n, s) => n + s.text.length, 0) <= COLLAPSE_THRESHOLD_CHARS,
    );
  }, [result]);

  const changes = countChangedSections(result.diff);
  const keptCount = hunks.length - rejected.size;
  const originalLabel = refined ? "previous result" : "original";
  const originalWords = diffInput.trim() === "" ? 0 : diffInput.trim().split(/\s+/).length;

  function save() {
    setSaveError(null);
    const payload = {
      input,
      output: effectiveOutput,
      rationale: result.rationale,
      mode,
      target,
      modelUsed: result.modelUsed,
      tokenIn: result.tokenIn,
      tokenOut: result.tokenOut,
      ...(result.title ? { title: result.title } : {}),
    };
    startSave(async () => {
      // Offline → queue to the outbox; it flushes on reconnect/foreground.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        await enqueueOutbox("save-prompt", payload);
        setQueued(true);
        return;
      }
      try {
        const res = await savePromptAction(payload);
        if (res.ok && res.promptId) setSavedId(res.promptId);
        else setSaveError(res.error ?? "Couldn't save.");
      } catch {
        await enqueueOutbox("save-prompt", payload);
        setQueued(true);
      }
    });
  }

  const exportData: ExportData = {
    input,
    output: effectiveOutput,
    rationale: result.rationale,
    mode,
    target,
    modelUsed: result.modelUsed,
  };

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(effectiveOutput);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Surfacing beats silence: tell the user copy did NOT happen.
      toast({
        tone: "error",
        text: "Couldn't copy — your browser blocked clipboard access. Select the text and copy manually.",
      });
    }
  }

  async function share() {
    const text = effectiveOutput;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: "VIZ(IO)N prompt", text });
        // The activity feed advertises "shared" events — log them when the
        // shared prompt is saved (the action existed, unwired). Swallow a
        // failed log so it never becomes an unhandled rejection.
        if (savedId) void logShareAction(savedId).catch(() => {});
        return;
      } catch {
        /* user cancelled or unsupported; fall through to copy */
      }
    }
    await copyOutput();
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
                : `${changes} changed section${changes === 1 ? "" : "s"}`}
            </p>
            {/* Quick copy — a 44px tap target that doesn't inflate the header row. */}
            <button
              type="button"
              onClick={copyOutput}
              aria-label={copied ? "Copied" : "Copy enhanced prompt"}
              className="-my-2 -mr-1.5 flex h-11 w-11 items-center justify-center rounded-full text-silver transition-[color,transform] duration-150 hover:text-chalk focus-visible:text-chalk active:scale-95"
            >
              {copied ? (
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 text-accent">
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
            </button>
          </div>
        </div>
        {/* OUTPUT REGION: result text + diff tokens render in mono (JetBrains). */}
        <p className="mono whitespace-pre-wrap break-words text-sm text-chalk">
          <OutputSegments segments={result.diff} hunkOf={hunkOf} rejected={rejected} />
        </p>
      </div>

      {/* 2 · Primary actions — Copy + Use, directly under the result. */}
      <div className={`grid gap-2 ${onUse ? "grid-cols-2" : "grid-cols-1"}`}>
        <button
          type="button"
          onClick={copyOutput}
          className="btn-laser flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-xl px-2 text-sm"
        >
          {copied ? "Copied ✓" : "Copy"}
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
                  className={`flex items-center justify-between gap-3 py-2 ${
                    isRejected ? "opacity-60" : ""
                  }`}
                >
                  {/* OUTPUT REGION: the change's before→after in mono. */}
                  <p className="mono min-w-0 break-words text-xs text-chalk">
                    <span className="line-through opacity-60">
                      {h.removed.trim() === "" ? "∅" : h.removed}
                    </span>
                    <span aria-hidden="true" className="font-body px-1.5 text-silver">
                      →
                    </span>
                    <span className={isRejected ? undefined : "text-accent"}>
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
        <div className="grid grid-cols-[1.35fr_1fr_1fr] gap-2">
          {savedId ? (
            <Link
              href={`/library/${savedId}`}
              className="flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-xl bg-pulse px-2 text-sm text-on-laser"
            >
              Saved ✓ — open
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
          <button
            type="button"
            onClick={share}
            className="glass flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-xl px-2 text-sm text-text hover-hair transition-colors"
          >
            Share
          </button>
          <button
            type="button"
            onClick={() => setCompareOpen(true)}
            className="glass flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-xl px-2 text-sm text-text hover-hair transition-colors"
          >
            Compare
          </button>
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
      {saveError && (
        <p className="font-body text-sm text-flare" role="alert">
          {saveError}
        </p>
      )}

      {/* 6 · Plain-language rationale. */}
      <div className="rounded-2xl border border-hair p-4">
        <p className="font-body mb-1 text-xs uppercase tracking-wider text-silver">
          What changed
        </p>
        <p className="font-body text-sm text-text">{result.rationale}</p>
        <p className="font-body mt-3 flex items-center gap-1.5 text-xs tabular-nums text-silver">
          <DeveloperIcon
            developer={TARGET_DEVELOPER[target]}
            className="h-3.5 w-3.5 shrink-0 text-accent"
          />
          {result.modelUsed} · {result.tokenIn}→{result.tokenOut} tok · $
          {result.costUsd.toFixed(4)}
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

      {/* 8 · Destination-specific changes — or the honest line for the
          shape-preserving modes, where the destination affects routing/cost
          only and nothing in the output is destination-formatted. */}
      {result.targetNotes ? (
        <div className="rounded-2xl border border-hair p-4">
          <p className="font-body mb-1 text-xs uppercase tracking-wider text-silver">
            For {TARGET_LABEL[target]}
          </p>
          <p className="font-body text-sm text-text">{result.targetNotes}</p>
        </div>
      ) : isShapePreserving(mode) ? (
        <p className="font-body text-center text-xs text-silver">
          {MODE_LABEL[mode]} keeps your prompt&apos;s shape — {TARGET_LABEL[target]} ran
          the rewrite, but no {TARGET_LABEL[target]}-specific formatting was applied.
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
          <div className="mt-2 rounded-2xl border border-hair bg-[color-mix(in_srgb,var(--void)_60%,transparent)] p-4">
            <p className="font-body mb-2 text-xs uppercase tracking-wider text-silver">
              {refined ? "Previous result" : "Input"}
            </p>
            {/* OUTPUT REGION: the input body renders in mono; removed tokens
                are dimmed + struck — equal + removed reconstructs it losslessly. */}
            <p className="mono whitespace-pre-wrap break-words text-sm text-silver">
              <InputSegments segments={result.diff} />
            </p>
          </div>
        )}
      </div>

      <CompareSheet
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        diff={result.diff}
        refined={refined}
        hunkOf={hunkOf}
        rejected={rejected}
      />
    </section>
  );
}

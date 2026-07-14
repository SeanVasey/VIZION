"use client";

import { useState } from "react";
import { useUIStore } from "@/stores/ui";
import { TARGET_MODELS, TARGET_DEVELOPER } from "@/lib/constants";
import { useEnhance } from "@/lib/enhance/use-enhance";
import { ModeRig } from "@/components/editor/ModeRig";
import { DeveloperIcon } from "@/components/models/DeveloperIcon";
import { TransformationDiff } from "@/components/diff/TransformationDiff";
import { StreamingResult } from "@/components/diff/StreamingResult";

/**
 * Enhance composer.  Wires the mode instrument, the Reddit-Sans prompt editor,
 * and the target picker to the UI store so selections persist across navigation.
 *
 * Balance rule (R5): full width is reserved for the Enhance CTA and the mode
 * grid; the target picker is a centered, content-width pill.  The result tree
 * (TransformationDiff) reads the input that was *submitted*, not the live draft,
 * so typing never re-renders the result (R8).
 */
export function EnhanceComposer() {
  const activeMode = useUIStore((s) => s.activeMode);
  const setActiveMode = useUIStore((s) => s.setActiveMode);
  const targetModel = useUIStore((s) => s.targetModel);
  const setTargetModel = useUIStore((s) => s.setTargetModel);
  const editorDraft = useUIStore((s) => s.editorDraft);
  const setEditorDraft = useUIStore((s) => s.setEditorDraft);

  const enhanceMutation = useEnhance();
  const result = enhanceMutation.data;
  const [submittedInput, setSubmittedInput] = useState("");

  // Cheap, deterministic token estimate (~4 chars/token) for the readout.
  const approxTokens = editorDraft.trim()
    ? Math.max(1, Math.ceil(editorDraft.trim().length / 4))
    : 0;

  const isEmpty = editorDraft.trim() === "";

  function runEnhance() {
    const input = editorDraft.trim();
    if (!input) return;
    setSubmittedInput(input);
    enhanceMutation.mutate({ input, mode: activeMode, target: targetModel });
  }

  function resetComposer() {
    setEditorDraft("");
    enhanceMutation.reset();
  }

  return (
    <section className="flex flex-col gap-5">
      {/* Mode instrument — full-width grid with the sliding lens-lock. */}
      <ModeRig activeMode={activeMode} onSelect={setActiveMode} />

      {/* Composer — a single rounded surface that nests the target picker into
          its top rail and the reset / Enhance actions into its bottom rail, so
          every control lives within the one rounded-rectangle. */}
      <div className="glass no-pull-refresh overflow-hidden rounded-2xl transition-shadow focus-within:shadow-focus">
        {/* Top rail — model target, nested under the rounded top corners. */}
        <div className="flex items-center justify-between gap-3 border-b border-hair px-3 py-2">
          <label
            htmlFor="target-model"
            className="font-body text-[0.625rem] uppercase tracking-[0.18em] text-silver"
          >
            Target
          </label>
          <div className="relative inline-flex items-center">
            {/* Native <option> can't render SVG, so the selected model's
                developer mark sits on the select's left edge (the mirror of
                the chevron on the right). */}
            <DeveloperIcon
              developer={TARGET_DEVELOPER[targetModel]}
              className="pointer-events-none absolute left-3 h-4 w-4 text-accent"
            />
            <select
              id="target-model"
              value={targetModel}
              onChange={(e) => setTargetModel(e.target.value as typeof targetModel)}
              className="font-body cursor-pointer appearance-none rounded-full bg-surface py-1.5 pl-9 pr-8 text-sm text-text focus:outline-none focus-visible:shadow-none"
            >
              {TARGET_MODELS.map((m) => (
                <option key={m.id} value={m.id} className="bg-onyx text-chalk">
                  {m.label}
                </option>
              ))}
            </select>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="pointer-events-none absolute right-2.5 h-4 w-4 text-silver"
            >
              <path
                d="M8 10l4 4 4-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        {/* Prompt editor — Reddit Sans (input is NOT the output region). */}
        <label htmlFor="prompt-input" className="sr-only">
          Prompt input
        </label>
        <textarea
          id="prompt-input"
          value={editorDraft}
          onChange={(e) => setEditorDraft(e.target.value)}
          placeholder="Type or paste your prompt…"
          rows={8}
          className="font-body block min-h-[180px] w-full resize-y bg-transparent px-3.5 py-3 text-sm text-text placeholder:text-muted focus:outline-none focus-visible:shadow-none"
        />

        {/* Bottom rail — readouts + reset / Enhance, nested under the rounded
            bottom corners so the whole composer reads as one object. */}
        <div className="flex items-center justify-between gap-2 border-t border-hair px-2.5 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <span className="font-body shrink-0 text-xs text-silver">📎 Media below</span>
            <span
              className="font-body shrink-0 text-xs text-silver"
              aria-live="polite"
            >
              ⌁ {approxTokens} tokens
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* RESET stays live during a run — it aborts the stream. */}
            <button
              type="button"
              onClick={resetComposer}
              disabled={!enhanceMutation.isPending && isEmpty && !result}
              className="btn-laser pill flex h-9 items-center gap-1.5 px-4 text-sm disabled:opacity-60"
            >
              <span aria-hidden="true">↺</span> RESET
            </button>
            <button
              type="button"
              onClick={runEnhance}
              disabled={enhanceMutation.isPending || isEmpty}
              className="btn-laser pill flex h-9 items-center gap-1.5 px-4 text-sm disabled:opacity-60"
            >
              {enhanceMutation.isPending ? "Enhancing…" : "► ENHANCE"}
            </button>
          </div>
        </div>
      </div>

      {/* Errors — provider-not-configured and cap messages get a friendly note.
          A deliberate cancel (status 0) is not an error the user should read. */}
      {enhanceMutation.isError && enhanceMutation.error.status !== 0 && (
        <p
          className={`font-body text-center text-sm ${
            enhanceMutation.error.capReached ? "text-amber" : "text-flare"
          }`}
          role="alert"
        >
          {enhanceMutation.error.notConfigured
            ? "This model isn't configured yet — add its API key on the server to enable it."
            : enhanceMutation.error.message}
        </p>
      )}

      {/* Amber storage/quota-style warning as the daily cap approaches. */}
      {result && result.usage.todayCost >= result.usage.capUsd * 0.8 && (
        <p className="font-body text-center text-xs text-amber" role="status">
          ⚠ ${result.usage.todayCost.toFixed(2)} of ${result.usage.capUsd.toFixed(2)}{" "}
          daily cap used
        </p>
      )}

      {/* Live stream surface while the run is in flight; the finished diff
          replaces it in the same footprint on done. */}
      {enhanceMutation.stream.active && !result && (
        <StreamingResult
          step={enhanceMutation.stream.step}
          partialOutput={enhanceMutation.stream.partialOutput}
          tokenIn={enhanceMutation.stream.tokenIn}
          tokenOut={enhanceMutation.stream.tokenOut}
          costUsd={enhanceMutation.stream.costUsd}
        />
      )}

      {result && (
        <TransformationDiff
          input={submittedInput}
          mode={activeMode}
          target={targetModel}
          result={result}
        />
      )}
    </section>
  );
}

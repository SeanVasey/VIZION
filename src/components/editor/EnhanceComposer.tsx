"use client";

import { useState } from "react";
import { useUIStore } from "@/stores/ui";
import { TARGET_MODELS } from "@/lib/constants";
import { useEnhance } from "@/lib/enhance/use-enhance";
import { ModeRig } from "@/components/editor/ModeRig";
import { TransformationDiff } from "@/components/diff/TransformationDiff";

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

  function runEnhance() {
    const input = editorDraft.trim();
    if (!input) return;
    setSubmittedInput(input);
    enhanceMutation.mutate({ input, mode: activeMode, target: targetModel });
  }

  return (
    <section className="flex flex-col gap-5">
      {/* Mode instrument — full-width grid with the sliding lens-lock. */}
      <ModeRig activeMode={activeMode} onSelect={setActiveMode} />

      {/* Prompt editor — Reddit Sans (input is NOT the output region). */}
      <div className="glass no-pull-refresh rounded-2xl p-1">
        <label htmlFor="prompt-input" className="sr-only">
          Prompt input
        </label>
        <textarea
          id="prompt-input"
          value={editorDraft}
          onChange={(e) => setEditorDraft(e.target.value)}
          placeholder="Type or paste your prompt…"
          rows={8}
          className="font-body w-full resize-y rounded-xl bg-transparent p-3 text-sm text-text placeholder:text-muted focus:outline-none"
        />
        <div className="flex items-center justify-between px-3 pb-2 pt-1">
          <span className="font-body text-xs text-silver">📎 Media reference below</span>
          <span className="font-body text-xs text-silver" aria-live="polite">
            ⌁ {approxTokens} tokens
          </span>
        </div>
      </div>

      {/* Target picker — centered, content-width pill (NOT full-bleed). */}
      <div className="flex flex-col items-center gap-1">
        <label
          htmlFor="target-model"
          className="font-body text-xs uppercase tracking-wider text-silver"
        >
          Target
        </label>
        <div className="glass inline-flex items-center rounded-full">
          <select
            id="target-model"
            value={targetModel}
            onChange={(e) => setTargetModel(e.target.value as typeof targetModel)}
            className="font-body cursor-pointer rounded-full bg-transparent px-4 py-2 text-center text-sm text-text focus:outline-none"
          >
            {TARGET_MODELS.map((m) => (
              <option key={m.id} value={m.id} className="bg-onyx text-chalk">
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <p className="font-body text-[0.625rem] text-silver">
          Same intent, fitted to the chosen engine.
        </p>
      </div>

      {/* Primary CTA — full-width pill, --on-laser ink on a Laser fill. */}
      <button
        type="button"
        onClick={runEnhance}
        disabled={enhanceMutation.isPending || editorDraft.trim() === ""}
        className="btn-laser pill flex min-h-[52px] items-center justify-center gap-2 px-6 text-base disabled:opacity-60"
      >
        {enhanceMutation.isPending ? "Enhancing…" : "► ENHANCE"}
      </button>

      {/* Errors — provider-not-configured and cap messages get a friendly note. */}
      {enhanceMutation.isError && (
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

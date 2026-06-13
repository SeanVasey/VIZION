"use client";

import { useUIStore } from "@/stores/ui";
import { MODES, TARGET_MODELS } from "@/lib/constants";
import { useEnhance } from "@/lib/enhance/use-enhance";
import { TransformationDiff } from "@/components/diff/TransformationDiff";

/**
 * Enhance composer (P1 shell).  Wires the mode chips, mono editor, and target
 * selector to the UI store so selections persist across navigation.  The
 * ENHANCE action is inert here — it becomes the provider-adapter call in P3.
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

  // Cheap, deterministic token estimate (~4 chars/token) for the readout.
  const approxTokens = editorDraft.trim()
    ? Math.max(1, Math.ceil(editorDraft.trim().length / 4))
    : 0;

  return (
    <section className="flex flex-col gap-5">
      {/* Mode chips — Laser fill marks the active mode. */}
      <div
        role="tablist"
        aria-label="Enhancement mode"
        className="-mx-1 flex flex-wrap gap-2 px-1"
      >
        {MODES.map((mode) => {
          const active = activeMode === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveMode(mode.id)}
              className={[
                "mono rounded-full px-4 py-2 text-sm uppercase tracking-wider transition-colors",
                active ? "bg-laser text-void" : "glass text-silver hover:text-chalk",
              ].join(" ")}
            >
              {mode.label}
            </button>
          );
        })}
      </div>

      {/* Mono editor — pull-to-refresh suppressed to protect in-progress text. */}
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
          className="mono w-full resize-y rounded-xl bg-transparent p-3 text-sm text-text placeholder:text-muted focus:outline-none"
        />
        <div className="flex items-center justify-between px-3 pb-2 pt-1">
          <button
            type="button"
            className="mono text-xs text-silver transition-colors hover:text-chalk"
            disabled
            title="Media attachments arrive in P5"
          >
            📎 Attach media
          </button>
          <span className="mono text-xs text-silver" aria-live="polite">
            ⌁ {approxTokens} tokens
          </span>
        </div>
      </div>

      {/* Target "club rack" — same intent, fitted to the chosen engine. */}
      <div className="flex flex-col gap-2">
        <label
          htmlFor="target-model"
          className="mono text-xs uppercase tracking-wider text-silver"
        >
          Target
        </label>
        <div className="glass rounded-xl">
          <select
            id="target-model"
            value={targetModel}
            onChange={(e) => setTargetModel(e.target.value as typeof targetModel)}
            className="font-body w-full rounded-xl bg-transparent px-4 py-3 text-base text-text focus:outline-none"
          >
            {TARGET_MODELS.map((m) => (
              <option key={m.id} value={m.id} className="bg-onyx text-chalk">
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Primary CTA — Void text on a Laser fill, never the reverse. */}
      <button
        type="button"
        onClick={() =>
          enhanceMutation.mutate({
            input: editorDraft.trim(),
            mode: activeMode,
            target: targetModel,
          })
        }
        disabled={enhanceMutation.isPending || editorDraft.trim() === ""}
        className="btn-laser flex min-h-[52px] items-center justify-center gap-2 rounded-xl px-6 text-base disabled:opacity-60"
      >
        {enhanceMutation.isPending ? "Enhancing…" : "► ENHANCE"}
      </button>

      {/* Errors — provider-not-configured and cap messages get a friendly note. */}
      {enhanceMutation.isError && (
        <p
          className={`mono text-center text-sm ${
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
        <p className="mono text-center text-xs text-amber" role="status">
          ⚠ ${result.usage.todayCost.toFixed(2)} of ${result.usage.capUsd.toFixed(2)}{" "}
          daily cap used
        </p>
      )}

      {result && (
        <TransformationDiff
          input={editorDraft.trim()}
          mode={activeMode}
          target={targetModel}
          result={result}
        />
      )}
    </section>
  );
}

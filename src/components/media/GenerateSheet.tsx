"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Sheet } from "@/components/ui/Sheet";
import { useUIStore } from "@/stores/ui";
import { buildGenerationPrompt } from "@/lib/media/formatters";
import { GEN_TARGETS, type GenTargetId } from "@/lib/media/types";
import { sanitizeName } from "@/lib/media/context";
import { savePromptAction } from "@/lib/library/actions";
import { enqueueOutbox } from "@/lib/pwa/outbox";
import { useCopy } from "@/components/ui/use-copy";
import { CheckMark } from "@/components/ui/glyphs";
import { highlightGenerationPrompt, stripEngineSyntax } from "@/lib/media/highlight";
import type { MediaItem } from "@/lib/media/queue";

/**
 * "Generate something similar" (2026-07 UX audit): generation is an EXPLICIT
 * choice with an EXPLICIT engine picker — every engine (Midjourney, Runway,
 * Sora, Kling, audio spec) is selectable, with the per-kind default merely
 * preselected. Never reached by merely attaching a file.
 */
export function GenerateSheet({
  item,
  onClose,
  onEngineChange,
}: {
  item: MediaItem;
  onClose: () => void;
  onEngineChange: (engine: GenTargetId) => void;
}) {
  const editorDraft = useUIStore((s) => s.editorDraft);
  const targetModel = useUIStore((s) => s.targetModel);
  // Recorded on the queued item so a replay cannot land in another
  // account on a shared device (IndexedDB is origin-scoped).
  const userId = useUIStore((s) => s.userId);
  const [engine, setEngine] = useState<GenTargetId>(item.genTarget ?? "midjourney");
  const [basePrompt, setBasePrompt] = useState("");
  const { copied, copy } = useCopy();
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveQueued, setSaveQueued] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const attrs = item.attrs;
  const generated = useMemo(() => {
    if (!attrs) return "";
    const base = (basePrompt || editorDraft || "").trim();
    return buildGenerationPrompt(base, attrs, engine);
  }, [attrs, basePrompt, editorDraft, engine]);
  const plain = useMemo(() => stripEngineSyntax(generated, engine), [generated, engine]);

  function pickEngine(next: GenTargetId) {
    setEngine(next);
    onEngineChange(next);
  }

  async function copyPrompt() {
    if (!generated) return;
    await copy(generated);
  }

  function save() {
    if (!generated) return;
    setSaveError(null);
    const payload = {
      input: (basePrompt || editorDraft || "").trim() || "(media reference)",
      output: generated,
      rationale: `Generation prompt from an attached ${item.kind} reference (${attrs?.source ?? "ondevice"}).`,
      mode: "target" as const,
      target: targetModel,
      modelUsed: `media:${attrs?.source ?? "ondevice"}`,
      tokenIn: 0,
      tokenOut: 0,
    };
    startSave(async () => {
      // Queue claims are gated on the write landing under a real owner
      // (SW-001/SW-002) — see TransformationDiff for the incident shape.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        if (userId && (await enqueueOutbox(userId, "save-prompt", payload))) {
          setSaveQueued(true);
        } else {
          setSaveError(
            "Couldn't queue this save on this device — copy the prompt before leaving.",
          );
        }
        return;
      }
      try {
        const res = await savePromptAction(payload);
        if (res.ok && res.promptId) setSavedId(res.promptId);
        else if (res.duplicate) {
          // This exact content is already in the library (LIB-007): link the
          // existing card instead of reporting a failure over a success state.
          setSavedId(res.duplicate.promptId);
        } else setSaveError(res.error ?? "Couldn't save to the library.");
      } catch {
        if (
          typeof navigator !== "undefined" &&
          navigator.onLine === false &&
          userId &&
          (await enqueueOutbox(userId, "save-prompt", payload))
        ) {
          setSaveQueued(true);
        } else {
          setSaveError("Couldn't save to the library — try again.");
        }
      }
    });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Generate — ${sanitizeName(item.name, 24)}`}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void copyPrompt()}
            className="btn-laser flex min-h-[44px] grow items-center justify-center rounded-xl px-4 text-sm"
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
          {savedId ? (
            <Link
              href={`/library/${savedId}`}
              className="flex min-h-[44px] grow items-center justify-center rounded-xl bg-pulse px-4 text-sm text-on-laser"
            >
              <span className="inline-flex items-center gap-1">
                Saved
                <CheckMark />
                — open
              </span>
            </Link>
          ) : saveQueued ? (
            <span className="font-body flex min-h-[44px] grow items-center justify-center rounded-xl bg-amber px-4 text-xs text-on-laser">
              Queued — syncs when online
            </span>
          ) : (
            <button
              type="button"
              onClick={save}
              disabled={saving || !generated}
              className="btn-secondary flex min-h-[44px] grow items-center justify-center rounded-xl px-4 text-sm disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save to library"}
            </button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Engine picker — every destination selectable, default preselected. */}
        <div role="group" aria-label="Generation engine" className="flex flex-wrap gap-2">
          {GEN_TARGETS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={engine === t.id}
              onClick={() => pickEngine(t.id)}
              className={`tap-44 font-body rounded-full px-3 py-1.5 text-xs transition-colors ${
                engine === t.id
                  ? "bg-laser font-medium text-on-laser"
                  : "glass text-silver hover:text-chalk"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <label htmlFor="generate-base-prompt" className="sr-only">
          Base prompt for generation
        </label>
        <textarea
          id="generate-base-prompt"
          value={basePrompt}
          onChange={(e) => setBasePrompt(e.target.value)}
          rows={3}
          placeholder={
            editorDraft ? "Using your editor prompt…" : "Describe what to generate…"
          }
          className="glass font-body w-full resize-y rounded-xl bg-transparent p-3 text-sm text-text placeholder:text-muted focus:outline-none"
        />

        <div className="glass rounded-2xl p-4">
          <p className="font-body mb-2 text-xs uppercase tracking-wider text-silver">
            Generation prompt · {GEN_TARGETS.find((t) => t.id === engine)?.label}
          </p>
          {/* OUTPUT REGION: generation prompt body in mono (JetBrains), with
              the engine flags, field labels and hex codes picked out so the
              editable parts are findable in the wall of text. */}
          <p className="mono whitespace-pre-wrap break-words text-sm text-chalk">
            {generated
              ? highlightGenerationPrompt(generated).map((tok, i) =>
                  tok.kind === "text" ? (
                    <span key={i}>{tok.text}</span>
                  ) : tok.kind === "hex" ? (
                    <span key={i} className="text-accent">
                      <span
                        aria-hidden="true"
                        className="mr-0.5 inline-block h-2.5 w-2.5 translate-y-[1px] rounded-sm border border-hair align-baseline"
                        style={{ backgroundColor: tok.text }}
                      />
                      {tok.text}
                    </span>
                  ) : (
                    <span
                      key={i}
                      className={tok.kind === "flag" ? "text-accent" : "text-silver"}
                    >
                      {tok.text}
                    </span>
                  ),
                )
              : "Attach analysis is still running…"}
          </p>
        </div>

        {/* Copy variants — engine syntax (Midjourney's flags, the motion
            engines' [tag]) helps in its own destination and hurts in a chat
            box, and JSON is what a script wants. Segmented on the export-strip
            pattern; the focus ring is INSET because the rounded chassis'
            overflow-hidden would clip an outer one. */}
        {generated && (
          <div className="glass flex items-stretch overflow-hidden rounded-xl">
            {(
              [
                { id: "full", label: "Copy", value: () => generated },
                // Plain only earns its place when it would actually differ.
                // The audio grammar emits no flags and no tag, so stripping is
                // a no-op there and the segment would copy exactly what Copy
                // copies — the same dead control the tag-strip just fixed for
                // the motion engines, one grammar over.
                ...(plain && plain !== generated
                  ? ([{ id: "plain", label: "Plain", value: () => plain }] as const)
                  : []),
                {
                  id: "json",
                  label: "JSON",
                  value: () =>
                    JSON.stringify(
                      {
                        engine,
                        base: (basePrompt || editorDraft || "").trim(),
                        prompt: generated,
                        attributes: attrs ?? null,
                      },
                      null,
                      2,
                    ),
                },
              ] as const
            ).map((seg) => (
              <button
                key={seg.id}
                type="button"
                onClick={() => void copy(seg.value())}
                className="font-body min-h-[44px] flex-1 border-r border-hair text-xs uppercase tracking-wide text-silver transition-colors last:border-r-0 hover:text-chalk focus-visible:shadow-[inset_0_0_0_1px_var(--accent-ink)]"
              >
                {seg.label}
              </button>
            ))}
          </div>
        )}

        {saveError && (
          <p className="font-body text-sm text-flare" role="alert">
            {saveError}
          </p>
        )}
      </div>
    </Sheet>
  );
}

"use client";

import { useRef, useState } from "react";
import { useUIStore } from "@/stores/ui";
import {
  TARGET_THINKING_LEVELS,
  THINKING_LEVEL_LABEL,
  type ModeId,
  type TargetModelId,
  type ThinkingLevel,
} from "@/lib/constants";
import { useEnhance, type EnhanceResponse } from "@/lib/enhance/use-enhance";
import type { RefineKind } from "@/lib/providers/formatters";
import { ModeRig } from "@/components/editor/ModeRig";
import { TargetPicker } from "@/components/models/TargetPicker";
import { TransformationDiff } from "@/components/diff/TransformationDiff";
import { StreamingResult } from "@/components/diff/StreamingResult";
import { PartialOutput } from "@/components/diff/PartialOutput";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { useToast } from "@/components/ui/Toast";
import { AttachmentTray } from "@/components/media/AttachmentTray";
import { KeyboardActionBar } from "@/components/editor/KeyboardActionBar";
import { TemplateSheet } from "@/components/editor/TemplateSheet";

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
  const autoTarget = useUIStore((s) => s.autoTarget);
  const setAutoTarget = useUIStore((s) => s.setAutoTarget);
  const setTargetModel = useUIStore((s) => s.setTargetModel);
  const thinkingLevels = useUIStore((s) => s.thinkingLevels);
  const setThinkingLevel = useUIStore((s) => s.setThinkingLevel);
  const editorDraft = useUIStore((s) => s.editorDraft);
  const setEditorDraft = useUIStore((s) => s.setEditorDraft);

  // The selected target's thinking ladder (absent = no knob = no selector),
  // and the stored choice — validated against the ladder so a stale
  // persisted level can never ride into the request.
  const levelOptions = TARGET_THINKING_LEVELS[targetModel];
  const storedLevel = thinkingLevels[targetModel];
  const thinkingLevel =
    levelOptions && storedLevel && levelOptions.includes(storedLevel)
      ? storedLevel
      : undefined;

  const enhanceMutation = useEnhance();
  const { toast } = useToast();
  // The rendered result + the snapshot of what was actually SUBMITTED — input
  // AND mode AND target. The result tree must read these, not the live store
  // values: flipping the mode grid or target select after a run must not
  // relabel the save payload, the exports, or the developer chip (R8).
  // Holding the result here (rather than reading enhanceMutation.data) is
  // what makes Clear undoable: mutation.reset() wipes the mutation, not the
  // snapshot we can restore.
  const [view, setView] = useState<{
    submitted: { input: string; mode: ModeId; target: TargetModelId };
    result: EnhanceResponse;
    /** True once a refinement pass replaced the result — the diff's input
     *  side is then the previous result, not the author's original. */
    refined?: boolean;
  } | null>(null);
  const [confirmStopOpen, setConfirmStopOpen] = useState(false);
  // Reference-role attachment context (built by the tray) — visual context
  // for the text task, sent alongside the enhance request.
  const [mediaContext, setMediaContext] = useState<string[]>([]);
  // Focus lives somewhere inside the composer — gates the keyboard action bar.
  const [composerFocused, setComposerFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  // The tray publishes its file intake here (it owns the privacy gate), so
  // paste and drop attach media through exactly the same path as the button.
  const intakeRef = useRef<((files: File[] | FileList) => void) | null>(null);
  // Clipboard read is Chromium/Safari-only and permission-gated; hide the
  // affordance entirely where it can't work rather than offering a dead button.
  const canPaste =
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.readText === "function";

  /** Pull text out of the clipboard into an empty draft. */
  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim() === "") return;
      setEditorDraft(text);
      document.getElementById("prompt-input")?.focus();
    } catch {
      // Denied, or dismissed at the native Paste prompt — say so instead of
      // failing silently, matching the copy-failure contract.
      toast({
        tone: "error",
        text: "Couldn't read the clipboard — paste with the keyboard instead.",
      });
    }
  }

  // Cheap, deterministic token estimate (~4 chars/token) for the readout.
  const approxTokens = editorDraft.trim()
    ? Math.max(1, Math.ceil(editorDraft.trim().length / 4))
    : 0;

  const isEmpty = editorDraft.trim() === "";

  function runEnhance() {
    const input = editorDraft.trim();
    if (!input) return;
    const submitted = { input, mode: activeMode, target: targetModel };
    setView(null);
    enhanceMutation.mutate(
      {
        input,
        mode: activeMode,
        // Under Auto this is the FALLBACK — the server resolves the real
        // target and reports it back. "auto" is never a target id: it has
        // nowhere to live in the model_target enum.
        target: targetModel,
        ...(autoTarget ? { auto: true as const } : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
        ...(mediaContext.length > 0 ? { mediaContext } : {}),
      },
      // mutate-level callbacks only fire for the latest call, so a stale
      // run that settles late can never overwrite a newer view.
      { onSuccess: (result) => setView({ submitted, result }) },
    );
  }

  /** Clear the draft + result. A pasted draft (or a finished result) is real
   *  work — the toast's Undo restores both. */
  function performClear() {
    const snapshot = { draft: editorDraft, view };
    setEditorDraft("");
    setView(null);
    enhanceMutation.reset(); // aborts an in-flight stream + clears error state
    if (snapshot.draft.trim() !== "" || snapshot.view) {
      toast({
        text: "Composer cleared",
        action: {
          label: "Undo",
          onAction: () => {
            setEditorDraft(snapshot.draft);
            setView(snapshot.view);
          },
        },
      });
    }
  }

  function onClear() {
    // Clearing mid-run cancels a paid request — that deserves a confirm.
    if (enhanceMutation.isPending) {
      setConfirmStopOpen(true);
      return;
    }
    performClear();
  }

  /** "Use as draft" — replace the editor draft with the result, undoably. */
  function handleUse(text: string) {
    const prior = editorDraft;
    setEditorDraft(text);
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document
      .getElementById("prompt-input")
      ?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    if (prior.trim() !== "" && prior !== text) {
      toast({
        text: "Draft replaced",
        action: { label: "Undo", onAction: () => setEditorDraft(prior) },
      });
    }
  }

  /** Refinement pass — seeded from the CURRENT output (with any per-change
   *  decisions applied), keeping the original submitted input for saves. */
  function handleRefine(kind: RefineKind, currentOutput: string) {
    if (!view || enhanceMutation.isPending) return;
    const v = view;
    // A refine sticks to the model that produced this output. Under Auto that
    // is the RESOLVED target, not the fallback — re-routing halfway through an
    // iteration would change voice mid-conversation, and `auto` is deliberately
    // not re-sent: the routing decision was already made for this result.
    const refineTarget = v.result.resolvedTarget ?? v.submitted.target;
    const ladder = TARGET_THINKING_LEVELS[refineTarget];
    const stored = thinkingLevels[refineTarget];
    const level = ladder && stored && ladder.includes(stored) ? stored : undefined;
    enhanceMutation.mutate(
      {
        input: currentOutput,
        mode: v.submitted.mode,
        target: refineTarget,
        ...(level ? { thinkingLevel: level } : {}),
        // Tone needs the author's ORIGINAL voice as reference material.
        refine: kind === "tone" ? { kind, baseInput: v.submitted.input } : { kind },
      },
      {
        onSuccess: (result) =>
          setView({ submitted: v.submitted, result, refined: true }),
      },
    );
  }

  return (
    <section className="flex flex-col gap-5">
      {/* Mode instrument — full-width grid with the sliding lens-lock. */}
      <ModeRig activeMode={activeMode} onSelect={setActiveMode} />

      {/* Composer — a single rounded surface that nests the target picker into
          its top rail and the reset / Enhance actions into its bottom rail, so
          every control lives within the one rounded-rectangle. */}
      <div
        className={`glass no-pull-refresh overflow-hidden rounded-2xl transition-shadow ${
          dragging ? "shadow-focus" : "focus-within:shadow-focus"
        }`}
        // React focus events bubble (focusin/focusout), so the chassis knows
        // when anything inside it holds focus — the signal the keyboard
        // action bar needs. relatedTarget guards focus moving WITHIN it.
        onFocus={() => setComposerFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setComposerFocused(false);
          }
        }}
        // Files.app drag (iPadOS) and desktop drag-and-drop. preventDefault on
        // dragover is what makes an element a valid drop target at all.
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDragging(false);
          }
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          intakeRef.current?.(e.dataTransfer.files);
        }}
      >
        {/* Top rail — model target, nested under the rounded top corners.
            A sheet rather than a native select: sixteen models across twelve
            developers need the grouping, and an <option> can't carry the
            developer mark. */}
        <div className="flex items-center justify-between gap-3 border-b border-hair px-3 py-2">
          <span className="font-body text-[0.625rem] uppercase tracking-[0.18em] text-silver">
            Target
          </span>
          <TargetPicker
            label="Target model"
            value={targetModel}
            onChange={setTargetModel}
            auto={autoTarget}
            onAutoChange={setAutoTarget}
            triggerClassName="font-body inline-flex min-h-[44px] items-center gap-2 rounded-full bg-surface py-1.5 pl-3 pr-2.5 text-sm text-text transition-colors hover:text-chalk"
          />
        </div>

        {/* Thinking rail — reasoning depth, only for targets whose provider
            takes a per-request level (TARGET_THINKING_LEVELS). "Auto" sends
            nothing and leaves the provider's own default in place; the choice
            persists per target, so switching models keeps each one's dial. */}
        {levelOptions && (
          <div className="flex items-center justify-between gap-3 border-b border-hair px-3 py-2">
            <label
              htmlFor="thinking-level"
              className="font-body text-[0.625rem] uppercase tracking-[0.18em] text-silver"
            >
              Thinking
            </label>
            <div className="relative inline-flex items-center">
              <select
                id="thinking-level"
                value={thinkingLevel ?? ""}
                onChange={(e) =>
                  setThinkingLevel(
                    targetModel,
                    e.target.value === "" ? null : (e.target.value as ThinkingLevel),
                  )
                }
                className="font-body cursor-pointer appearance-none rounded-full bg-surface py-1.5 pl-4 pr-8 text-sm text-text focus:outline-none focus-visible:shadow-none"
              >
                <option value="" className="bg-onyx text-chalk">
                  Auto
                </option>
                {levelOptions.map((level) => (
                  <option key={level} value={level} className="bg-onyx text-chalk">
                    {THINKING_LEVEL_LABEL[level]}
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
        )}

        {/* Prompt editor — Reddit Sans (input is NOT the output region). */}
        <label htmlFor="prompt-input" className="sr-only">
          Prompt input
        </label>
        <textarea
          id="prompt-input"
          value={editorDraft}
          onChange={(e) => setEditorDraft(e.target.value)}
          // Pasted TEXT falls through to the native insert (never hijack the
          // caret); pasted FILES — a screenshot from the iOS clipboard — go to
          // the tray instead of dropping on the floor.
          onPaste={(e) => {
            const files = e.clipboardData.files;
            if (files.length === 0) return;
            e.preventDefault();
            intakeRef.current?.(files);
          }}
          placeholder="Type or paste your prompt…"
          rows={8}
          className="font-body block min-h-[180px] w-full resize-y bg-transparent px-3.5 py-3 text-sm text-text placeholder:text-muted focus:outline-none focus-visible:shadow-none"
        />

        {dragging && (
          <p
            className="font-body border-t border-hair px-3.5 py-2 text-center text-xs text-accent"
            role="status"
          >
            Drop to attach
          </p>
        )}

        {/* Paste affordance — offered only when there is nothing to lose and
            the field is live. In flow (not floating) so the chassis'
            overflow-hidden can't clip it and it never covers the draft.
            iOS raises its own Paste confirmation on readText; that native
            second tap is the platform's, not ours to route around. */}
        {isEmpty && !dragging && (
          <div className="flex flex-wrap gap-2 border-t border-hair px-3.5 py-2">
            {canPaste && composerFocused && (
              <button
                type="button"
                // Keep focus (and the keyboard) through the tap.
                onPointerDown={(e) => e.preventDefault()}
                onClick={pasteFromClipboard}
                className="glass font-body pill tap-44 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-silver transition-colors hover:text-chalk"
              >
                <span aria-hidden="true">⌸</span> Paste from clipboard
              </button>
            )}
            {/* The blank page needs a way in that isn't typing. Offered only
                while the draft is empty, so it can never overwrite work. */}
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setTemplatesOpen(true)}
              className="glass font-body pill tap-44 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-silver transition-colors hover:text-chalk"
            >
              <span aria-hidden="true">✦</span> Try a template
            </button>
          </div>
        )}

        {/* Attachment tray — media lives INSIDE the composer (2026-07 audit);
            reference-role context flows into the enhance request above. */}
        <AttachmentTray onContextChange={setMediaContext} intakeRef={intakeRef} />

        {/* Bottom rail — readouts + clear / Enhance, nested under the rounded
            bottom corners so the whole composer reads as one object. */}
        <div className="flex items-center justify-between gap-2 border-t border-hair px-2.5 py-2">
          <div className="flex min-w-0 items-center gap-3">
            {/* No aria-live: the count changes per keystroke and would flood
                screen readers — it's a passive visual readout. */}
            <span className="font-body shrink-0 text-xs tabular-nums text-silver">
              <span aria-hidden="true">⌁ </span>
              {approxTokens} tokens
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {/* Clear is deliberately tertiary (2026-07 UX audit): it destroys a
                pasted draft, so it must not share ENHANCE's filled-primary
                treatment. It stays live during a run (aborting the stream)
                behind a confirm; otherwise it clears with an Undo toast. */}
            <button
              type="button"
              onClick={onClear}
              disabled={!enhanceMutation.isPending && isEmpty && !view}
              className="tap-44 font-body flex items-center gap-1 px-1 text-xs text-silver transition-colors hover:text-chalk disabled:opacity-50"
            >
              <span aria-hidden="true">↺</span> Clear
            </button>
            {/* h-11 (44px tap target) with -my-1 so the rail keeps its height.
                ENHANCE is the ONLY filled-Laser primary in the composer. */}
            <button
              type="button"
              onClick={runEnhance}
              disabled={enhanceMutation.isPending || isEmpty}
              className="btn-laser pill -my-1 flex h-11 items-center gap-1.5 px-4 text-sm disabled:opacity-60"
            >
              {enhanceMutation.isPending ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Enhancing…
                </>
              ) : (
                "► ENHANCE"
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Errors — provider-not-configured and cap messages get a friendly note.
          A deliberate cancel (status 0) is not an error the user should read. */}
      {enhanceMutation.isError && enhanceMutation.error.status !== 0 && (
        <>
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
          {/* Anything that already streamed in survives the failure — a run
              that dies at 90% must not erase copyable work (the hook retains
              partialOutput on error). When a previous result is still
              rendered (a failed refine), that result is the better recovery
              material — don't stack a partial refinement on top of it. */}
          {!view && enhanceMutation.stream.partialOutput && (
            <PartialOutput
              text={enhanceMutation.stream.partialOutput}
              onUse={handleUse}
            />
          )}
        </>
      )}

      {/* Amber storage/quota-style warning as the daily cap approaches. */}
      {view && view.result.usage.todayCost >= view.result.usage.capUsd * 0.8 && (
        <p className="font-body text-center text-xs text-amber" role="status">
          ⚠ ${view.result.usage.todayCost.toFixed(2)} of $
          {view.result.usage.capUsd.toFixed(2)} daily cap used
        </p>
      )}

      {/* Live stream surface while the run is in flight; the finished diff
          replaces it in the same footprint on done. */}
      {/* `isPending` as well as `stream.active`: the hook clears `active` in
          its finally block while `view` is only set in onSuccess, leaving one
          frame where neither surface is mounted — the flash between the
          streaming card and the finished result. Holding the streaming card
          until the result actually exists closes it. */}
      {(enhanceMutation.stream.active || enhanceMutation.isPending) && !view && (
        <StreamingResult
          step={enhanceMutation.stream.step}
          partialOutput={enhanceMutation.stream.partialOutput}
          tokenIn={enhanceMutation.stream.tokenIn}
          tokenOut={enhanceMutation.stream.tokenOut}
          costUsd={enhanceMutation.stream.costUsd}
        />
      )}

      {view && (
        <TransformationDiff
          input={view.submitted.input}
          mode={view.submitted.mode}
          target={view.submitted.target}
          result={view.result}
          refined={view.refined ?? false}
          refinePending={enhanceMutation.isPending}
          onUse={handleUse}
          onRefine={handleRefine}
        />
      )}

      {/* Keeps ENHANCE reachable above the software keyboard (P0). Portaled
          and inset-positioned inside the component; a no-op without one. */}
      <KeyboardActionBar
        active={composerFocused}
        tokens={approxTokens}
        pending={enhanceMutation.isPending}
        disabled={enhanceMutation.isPending || isEmpty}
        onEnhance={runEnhance}
      />

      <TemplateSheet
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onPick={(t) => {
          setEditorDraft(t.text);
          setActiveMode(t.mode);
          document.getElementById("prompt-input")?.focus();
        }}
      />

      <ConfirmSheet
        open={confirmStopOpen}
        onClose={() => setConfirmStopOpen(false)}
        title="Stop this run?"
        body="This cancels the enhancement in progress and clears your draft."
        confirmLabel="Stop & clear"
        destructive
        onConfirm={performClear}
      />
    </section>
  );
}

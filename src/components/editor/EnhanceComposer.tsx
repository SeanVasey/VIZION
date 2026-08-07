"use client";

import { useCallback, useRef, useState } from "react";
import { useUIStore } from "@/stores/ui";
import { useEnhanceViewStore } from "@/stores/enhance-view";
import { TARGET_THINKING_LEVELS, type ThinkingLevel } from "@/lib/constants";
import { useEnhance } from "@/lib/enhance/use-enhance";
import type { RefineKind } from "@/lib/providers/formatters";
import { ModeRig } from "@/components/editor/ModeRig";
import { TargetPicker } from "@/components/models/TargetPicker";
import { ThinkingPicker } from "@/components/models/ThinkingPicker";
import { TransformationDiff } from "@/components/diff/TransformationDiff";
import { StreamingResult } from "@/components/diff/StreamingResult";
import { PartialOutput } from "@/components/diff/PartialOutput";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { PressableButton } from "@/components/ui/PressableButton";
import { useToast } from "@/components/ui/Toast";
import { AttachmentTray } from "@/components/media/AttachmentTray";
import { KeyboardActionBar } from "@/components/editor/KeyboardActionBar";
import { TemplateSheet } from "@/components/editor/TemplateSheet";
import { Segmented } from "@/components/ui/Segmented";
import { TemplateMark, WarningMark } from "@/components/ui/glyphs";
import { useDraftParam } from "@/components/editor/use-draft-param";
import { FORMATS, FORMAT_LABEL } from "@/lib/enhance/formats";
import { LENGTHS, lengthOptions } from "@/lib/enhance/lengths";

/** Frozen option list for the format rail — built once, not per render. */
const FORMAT_OPTIONS = FORMATS.map((id) => ({ id, label: FORMAT_LABEL[id] }));

/**
 * The control pill shared by the Target and Thinking rails.
 *
 * ONE string, two consumers, on purpose. The rails stack directly on top of
 * each other, so the pills are read as a pair and any divergence in type size
 * or padding reads as a bug — which is exactly what shipped while Thinking was
 * a `<select>` (see ThinkingPicker's header for the iOS 16px floor that caused
 * it). Two copies of the same class string is how that drift comes back.
 */
const RAIL_TRIGGER_CLASS =
  "font-body inline-flex min-h-[44px] items-center gap-2 rounded-full bg-surface py-1.5 pl-3 pr-2.5 text-sm text-text transition-colors hover:text-chalk";

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
  const reformatFormat = useUIStore((s) => s.reformatFormat);
  const setReformatFormat = useUIStore((s) => s.setReformatFormat);
  const lengthByMode = useUIStore((s) => s.lengthByMode);
  const setLengthForMode = useUIStore((s) => s.setLengthForMode);
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

  // The current mode's length dial, if it has one — and its stored value
  // re-validated against that mode's options, the same discipline the
  // thinking rail applies to a stale persisted level.
  const lengthChoices = lengthOptions(activeMode);
  const storedLength = lengthByMode[activeMode];
  const activeLength =
    lengthChoices && storedLength && LENGTHS.includes(storedLength) ? storedLength : null;

  // `?draft=` prefill (Siri Shortcuts and the iOS share sheet land here).
  // A conflict comes back as `pending` and is rendered as a persistent banner
  // below — never a toast, which would put a six-second deadline on a
  // decision about the user's own text.
  const sharedDraft = useDraftParam();

  const enhanceMutation = useEnhance();
  // `mutate` is stable across renders (TanStack), unlike the enhanceMutation
  // object itself (a fresh spread each render) — so the useCallback handlers
  // below depend on `runMutation`/`isPending`, never the whole object, keeping
  // their identity stable so the memoized result view + rails hold (PERF-003/006).
  const { mutate: runMutation, isPending } = enhanceMutation;
  const { toast } = useToast();
  // The rendered result + the R8 submitted snapshot (see EnhanceView). In the
  // view STORE, not component state, and both halves of that matter. Holding
  // the result outside enhanceMutation.data is what makes Clear undoable:
  // mutation.reset() wipes the mutation, not the snapshot we can restore. And
  // holding it outside the component is what lets it survive navigation — as
  // useState it died with the route, so visiting Library or Profile silently
  // destroyed a result the user had already paid tokens for.
  const view = useEnhanceViewStore((s) => s.view);
  const setView = useEnhanceViewStore((s) => s.setView);
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

  const runEnhance = useCallback(() => {
    const input = useUIStore.getState().editorDraft.trim();
    if (!input) return;
    const submitted = {
      input,
      mode: activeMode,
      target: targetModel,
      ...(activeMode === "reformat" && reformatFormat ? { format: reformatFormat } : {}),
      ...(activeLength ? { length: activeLength } : {}),
    };
    setView(null);
    runMutation(
      {
        input,
        mode: activeMode,
        // Under Auto this is the FALLBACK — the server resolves the real
        // target and reports it back. "auto" is never a target id: it has
        // nowhere to live in the model_target enum.
        target: targetModel,
        ...(autoTarget ? { auto: true as const } : {}),
        ...(activeMode === "reformat" && reformatFormat
          ? { format: reformatFormat }
          : {}),
        ...(activeLength ? { length: activeLength } : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
        ...(mediaContext.length > 0 ? { mediaContext } : {}),
      },
      // mutate-level callbacks only fire for the latest call, so a stale
      // run that settles late can never overwrite a newer view.
      { onSuccess: (result) => setView({ submitted, result }) },
    );
  }, [
    activeMode,
    targetModel,
    autoTarget,
    reformatFormat,
    activeLength,
    thinkingLevel,
    mediaContext,
    runMutation,
    setView,
  ]);

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
  const handleUse = useCallback(
    (text: string) => {
      // Read the prior draft imperatively (not a closure dep) so this callback
      // keeps a stable identity across keystrokes — otherwise the memoized
      // result view re-renders on every keystroke (PERF-003).
      const prior = useUIStore.getState().editorDraft;
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
    },
    [setEditorDraft, toast],
  );

  /** Refinement pass — seeded from the CURRENT output (with any per-change
   *  decisions applied), keeping the original submitted input for saves. */
  const handleRefine = useCallback(
    (kind: RefineKind, currentOutput: string) => {
      if (!view || isPending) return;
      const v = view;
      // A refine sticks to the model that produced this output. Under Auto that
      // is the RESOLVED target, not the fallback — re-routing halfway through an
      // iteration would change voice mid-conversation, and `auto` is deliberately
      // not re-sent: the routing decision was already made for this result.
      const refineTarget = v.result.resolvedTarget ?? v.submitted.target;
      const ladder = TARGET_THINKING_LEVELS[refineTarget];
      const stored = thinkingLevels[refineTarget];
      const level = ladder && stored && ladder.includes(stored) ? stored : undefined;
      runMutation(
        {
          input: currentOutput,
          mode: v.submitted.mode,
          target: refineTarget,
          // The run's knob snapshot carries through (Q4): a chosen shape or
          // depth was an explicit withdrawal of latitude — the refine keeps it,
          // and the refine instruction supersedes it only where they conflict.
          ...(v.submitted.format ? { format: v.submitted.format } : {}),
          ...(v.submitted.length ? { length: v.submitted.length } : {}),
          ...(level ? { thinkingLevel: level } : {}),
          // Tone needs the author's ORIGINAL voice as reference material.
          refine: kind === "tone" ? { kind, baseInput: v.submitted.input } : { kind },
        },
        {
          onSuccess: (result) =>
            setView({ submitted: v.submitted, result, refined: true }),
        },
      );
    },
    [view, thinkingLevels, isPending, runMutation, setView],
  );

  /** Clarify's answered re-run. NOT a refinement of the output — a redo of
   *  the ORIGINAL request with the model's own questions answered, so `input`
   *  is the author's text and the Q&A rides in `baseInput` (the tone
   *  precedent). One round: the answered pass is told not to ask again. */
  const handleAnswer = useCallback(
    (questions: string[], answers: string[]) => {
      if (!view || isPending) return;
      const v = view;
      const block = questions
        .map((q, i) => `Q: ${q}\nA: ${answers[i]?.trim() || "(no answer given)"}`)
        .join("\n\n");
      const answeredTarget = v.result.resolvedTarget ?? v.submitted.target;
      const ladder = TARGET_THINKING_LEVELS[answeredTarget];
      const stored = thinkingLevels[answeredTarget];
      const level = ladder && stored && ladder.includes(stored) ? stored : undefined;
      runMutation(
        {
          input: v.submitted.input,
          mode: v.submitted.mode,
          ...(v.submitted.format ? { format: v.submitted.format } : {}),
          ...(v.submitted.length ? { length: v.submitted.length } : {}),
          target: answeredTarget,
          ...(level ? { thinkingLevel: level } : {}),
          refine: { kind: "answers", baseInput: block },
        },
        {
          // `refined` stays false: this is the original request answered, not a
          // pass over a previous output, so the diff's input side is still the
          // author's own text and must keep saying "original".
          onSuccess: (result) => setView({ submitted: v.submitted, result }),
        },
      );
    },
    [view, thinkingLevels, isPending, runMutation, setView],
  );

  // The daily-cap warning, resolved here so its live region can be mounted
  // unconditionally in the tree below.
  const capUsage = view?.result.usage;
  const capWarning =
    capUsage && capUsage.todayCost >= capUsage.capUsd * 0.8
      ? `$${capUsage.todayCost.toFixed(2)} of $${capUsage.capUsd.toFixed(2)} daily cap used`
      : null;

  // Stable-identity so the memoized ThinkingPicker holds across stream flushes
  // (PERF-006) — the inline arrow it replaces was a fresh function each render.
  const onThinkingChange = useCallback(
    (next: ThinkingLevel | null) => setThinkingLevel(targetModel, next),
    [targetModel, setThinkingLevel],
  );

  return (
    <section className="flex flex-col gap-5">
      {/* An incoming shared prompt that would have overwritten real work.
          Stays until it is answered — the parameter is still in the URL
          behind it, so even a reload cannot lose it. */}
      {sharedDraft.pending !== null && (
        <div className="glass flex flex-col gap-2 rounded-2xl border border-hair p-4">
          <p className="font-body text-xs uppercase tracking-wider text-silver">
            A prompt was shared to VIZ(IO)N
          </p>
          <p className="font-body line-clamp-3 text-sm text-text">
            {sharedDraft.pending}
          </p>
          <p className="font-body text-xs text-silver">
            Your composer already has a draft — replacing it can be undone.
          </p>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                // Snapshot at CLICK time, not when the offer appeared, so
                // anything typed in between is what Undo restores.
                const previous = editorDraft;
                sharedDraft.accept();
                toast({
                  text: "Draft replaced",
                  action: {
                    label: "Undo",
                    onAction: () => setEditorDraft(previous),
                  },
                });
              }}
              className="btn-laser font-body flex min-h-[44px] items-center justify-center rounded-xl px-3 text-sm"
            >
              Replace draft
            </button>
            <button
              type="button"
              onClick={sharedDraft.dismiss}
              className="glass font-body flex min-h-[44px] items-center justify-center rounded-xl px-3 text-sm text-text hover-hair transition-colors"
            >
              Discard it
            </button>
          </div>
        </div>
      )}

      {/* Mode instrument — full-width grid with the sliding lens-lock. */}
      <ModeRig activeMode={activeMode} onSelect={setActiveMode} />

      {/* Composer — a single rounded surface that nests the target picker into
          its top rail and the reset / Enhance actions into its bottom rail, so
          every control lives within the one rounded-rectangle.

          `.glass-solid`, not `.glass`: this is the app's primary work surface,
          and the translucent tier let the ambient mesh read through it — at
          rest (a bright node bleeds through 72% alpha even blurred) and worse
          during the scroll stand-down (both reported on device, 2026-08).
          The opaque tier keeps the hairline/sheen/grain material language and
          guarantees nothing behind the draft ever shows through it. */}
      <div
        className={`glass-solid no-pull-refresh overflow-hidden rounded-2xl transition-shadow ${
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
            triggerClassName={RAIL_TRIGGER_CLASS}
          />
        </div>

        {/* Thinking rail — reasoning depth, only for targets whose provider
            takes a per-request level (TARGET_THINKING_LEVELS). "Auto" sends
            nothing and leaves the provider's own default in place; the choice
            persists per target, so switching models keeps each one's dial.

            Trigger + sheet rather than a `<select>`, on the same grounds as the
            Target rail above it: a select is floored at 16px on iOS and would
            render this pill's label larger than the one directly above it. The
            caption is a `<span>` because there is no longer a form element for
            `htmlFor` to point at — the trigger carries its own accessible name. */}
        {levelOptions && (
          <div className="flex items-center justify-between gap-3 border-b border-hair px-3 py-2">
            <span className="font-body text-[0.625rem] uppercase tracking-[0.18em] text-silver">
              Thinking
            </span>
            <ThinkingPicker
              label="Thinking depth"
              value={thinkingLevel}
              options={levelOptions}
              onChange={onThinkingChange}
              triggerClassName={RAIL_TRIGGER_CLASS}
            />
          </div>
        )}

        {/* Format rail — Reformat only. Naming the shape is what separates
            Reformat (SHAPE) from Adapt (ENGINE IDIOM); leaving it unset keeps
            the old "whichever fits the task" behaviour, so the rail adds
            control without removing the shortcut. Segmented buttons rather
            than a select: the rails stay outside the iOS focus-zoom rule. */}
        {activeMode === "reformat" && (
          <SegmentedRail
            caption="Shape"
            label="Output shape"
            options={FORMAT_OPTIONS}
            value={reformatFormat}
            // Re-picking the active shape clears it, which is the only way
            // back to "whichever fits" without a separate Auto segment
            // competing for width on a 390px screen.
            onChange={(next) => setReformatFormat(next === reformatFormat ? null : next)}
          />
        )}

        {/* Length rail — Condense and Expand only. The dial is shared but the
            LABELS are per mode: the aggressive end of Condense is the smallest
            output and the aggressive end of Expand is the largest, so one set
            of words would read as a lie on one of the two. */}
        {lengthChoices && (
          <SegmentedRail
            caption="Depth"
            label="Length"
            options={lengthChoices}
            value={activeLength}
            onChange={(next) =>
              setLengthForMode(activeMode, next === activeLength ? null : next)
            }
          />
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
              <TemplateMark className="h-3.5 w-3.5 shrink-0" /> Try a template
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
              {/* "≈": chars/4 is an estimate, and the result line renders the
                  authoritative provider counts — the two must not read as the
                  same kind of number (PRI-014, INV-04 cost truth). */}
              ≈{approxTokens} tokens
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
            <PressableButton
              subtle
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
            </PressableButton>
          </div>
        </div>
      </div>

      {/* Errors — provider-not-configured and cap messages get a friendly note.
          A deliberate cancel (status 0) is not an error the user should read. */}
      {enhanceMutation.isError && enhanceMutation.error.status !== 0 && (
        <>
          <p
            className={`font-body text-center text-sm ${
              enhanceMutation.error.capReached ? "text-amber-ink" : "text-flare"
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

      {/* Amber storage/quota-style warning as the daily cap approaches.

          The region is mounted whether or not the warning applies: a
          `role="status"` element that appears already carrying its text is not
          reliably announced, and this is the only notice a user gets that they
          are about to be cut off mid-session. Idle is `sr-only` (absolutely
          positioned) so it is not a flex item and adds no gap to this column —
          the same shape as FieldStatus. */}
      {/* Completion announcement (A11Y-005): the step live region unmounts
          with the stream and the result view mounts silently — a screen
          reader heard "Generating…" and then nothing. Permanently mounted;
          the text mutation is the announcement. */}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {view && !enhanceMutation.isPending
          ? `Enhancement ready — ${view.refined ? "refined result" : "result"} below.`
          : ""}
      </p>
      <p
        role="status"
        className={
          capWarning ? "font-body text-center text-xs text-amber-ink" : "sr-only"
        }
      >
        {capWarning ? (
          <>
            <WarningMark className="mr-1 inline-block h-[1em] w-[1em] align-[-0.125em]" />
            {capWarning}
          </>
        ) : (
          ""
        )}
      </p>

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
          onAnswer={handleAnswer}
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

/**
 * A composer rail carrying a segmented control (Shape · Depth).
 *
 * STACKED, not label-left/control-right like the Target and Thinking rails,
 * and that is the whole point of the component. Those two rails hold ONE
 * intrinsically-narrow pill; these hold three-to-five multi-word labels, and
 * beside a caption there is only ~300px of a 390px screen left for them. The
 * inline version overflowed it: the chassis clipped mid-segment and "Few-shot"
 * broke across two lines, which made the rail visibly taller than its
 * neighbours and misaligned the whole stack. Giving the control its own full
 * -width line buys back the caption's width, so equal 1fr cells fit every
 * label on one line at any roster size the rails use.
 *
 * The caption is a `<span>` + `aria-label` on the group rather than a `<label>`
 * — the control is a button group, and a `<label>` has no single form element
 * to point `htmlFor` at.
 */
function SegmentedRail<T extends string>({
  caption,
  label,
  options,
  value,
  onChange,
}: {
  /** Rail caption, in the rails' tracked micro-caps. */
  caption: string;
  /** Accessible name for the control itself. */
  label: string;
  options: readonly { id: T; label: string }[];
  value: T | null;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-hair px-3 py-2.5">
      <span className="font-body text-[0.625rem] uppercase tracking-[0.18em] text-silver">
        {caption}
      </span>
      <Segmented fill label={label} options={options} value={value} onChange={onChange} />
    </div>
  );
}

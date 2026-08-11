"use client";

import { memo, useMemo, useRef, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { CheckGlyph } from "@/components/ui/CheckGlyph";
import { HoldSliderHint, HoldSliderTrigger } from "@/components/ui/HoldSlider";
import { useRovingRadios } from "@/components/models/use-roving-radios";
import { DeveloperIcon } from "@/components/models/DeveloperIcon";
import { targetLabel } from "@/components/models/target-label";
import {
  BUDGET_DETENTS,
  BUDGET_PEAK_CAPTION,
  TONE_INK_CLASS,
} from "@/components/models/dial-detents";
import {
  PICKER_TRIGGER_FALLBACK_CLASS,
  PickerChevron,
} from "@/components/models/picker-trigger";
import {
  AUTO_PREFERENCE_LABEL,
  DEVELOPER_LABEL,
  DEVELOPER_ORDER,
  TARGET_DEVELOPER,
  TARGET_MODELS,
  type AutoPreference,
  type Developer,
  type TargetModelId,
} from "@/lib/constants";

/**
 * Model target picker — trigger + grouped sheet.
 *
 * Replaces the native `<select>` on both surfaces that pick a model. A native
 * select can't render the developer marks (an `<option>` takes text only), so
 * sixteen models across twelve developers arrived as one flat alphabet-soup
 * list with the mark stranded outside on the control's edge, describing only
 * whichever row happened to be selected. Grouping is the whole point: the
 * roster is *already* ordered by developer (`DEVELOPER_ORDER`, contiguity
 * test-pinned), so the headers make a structure that was always there visible.
 *
 * Leaving `<select>` also leaves the scope of the iOS 16px rule — it targets
 * `input, select, textarea` — so the trigger can honestly render at `text-sm`
 * without tripping focus-zoom. The Sheet primitive supplies the portal, focus
 * trap, Escape, and scroll lock.
 */

type TargetModel = (typeof TARGET_MODELS)[number];

/** Models grouped under their developer, in roster order. Computed once: the
 *  roster is a frozen literal, so this can never go stale at runtime. A
 *  developer with no models is dropped rather than rendered as an empty
 *  header — DEVELOPER_ORDER is allowed to run ahead of the roster. */
const GROUPS: { developer: Developer; models: TargetModel[] }[] = DEVELOPER_ORDER.map(
  (developer) => ({
    developer,
    models: TARGET_MODELS.filter((m): m is TargetModel => m.developer === developer),
  }),
).filter((g) => g.models.length > 0);

/** Keys the sheet's roving-radio handler claims. The tuning dial renders
 *  INSIDE the radiogroup element, so without a stop these bubble up, get
 *  preventDefault'd, and yank focus onto a model radio mid-interaction
 *  (Codex review, PR #96 — written for the Segmented this replaced, and
 *  MORE load-bearing now: the dial is a `role="slider"` whose whole keyboard
 *  contract is arrows, so a leak would have the two controls fighting over
 *  every one of them). */
const ROVING_NAV_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

// Memoized: nested in the composer, which re-renders per keystroke and per SSE
// flush. Its props are all stable identity (store values + store setters), so
// the memo holds and the picker reconciles only when the target actually
// changes (PERF-006).
export const TargetPicker = memo(TargetPickerImpl);

function TargetPickerImpl({
  value,
  onChange,
  label,
  triggerClassName,
  disabled,
  holdHint,
  auto,
  onAutoChange,
  autoPreference,
  onAutoPreferenceChange,
  streaming,
}: {
  value: TargetModelId;
  onChange: (next: TargetModelId) => void;
  /** Accessible name for the trigger, e.g. "Target model". */
  label: string;
  triggerClassName?: string;
  disabled?: boolean;
  /** True while a HoldSliderTrigger around this pill is live — renders the
   *  resting detent-dot affordance. The composer passes its slider's own
   *  `enabled`; surfaces with no slider (Settings) omit it and stay clean. */
  holdHint?: boolean;
  /**
   * Auto routing. Pass BOTH to offer it — omitting them hides the row
   * entirely, which is how Settings keeps `profiles.default_model` a real
   * enum id. "auto" is never a value of `value`; it sits beside it.
   */
  auto?: boolean;
  onAutoChange?: (next: boolean) => void;
  /**
   * Auto's routing preference (quality / balanced / budget). Pass both to
   * offer the segments under the Auto row — same wiring contract as the Auto
   * pair, so Settings (which offers neither) stays clean automatically.
   */
  autoPreference?: AutoPreference;
  onAutoPreferenceChange?: (next: AutoPreference) => void;
  /**
   * True while a run is in flight, for the tuning dial's capsule inside the
   * sheet (Codex review, PR #109). It rode on the composer's own wrapper
   * until the dial moved in here, and was simply dropped in the move — so
   * the capsule's full-viewport `backdrop-filter` re-filtered on every
   * streamed repaint, the exact trap `dynamicBackdrop` exists to avoid
   * (ADR-0012, eighth pass). The rails stay live mid-run by design, so this
   * state is reachable: the sheet opens over a streaming composer.
   *
   * A boolean that flips at stream start and end, never per flush, so the
   * memo on this component still holds across SSE frames (PERF-006).
   */
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const developer = TARGET_DEVELOPER[value];
  const offersAuto = onAutoChange !== undefined;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={triggerClassName ?? PICKER_TRIGGER_FALLBACK_CLASS}
      >
        <span className="sr-only">{label}: </span>
        {auto ? (
          <AutoGlyph className="h-4 w-4 text-accent" />
        ) : (
          developer && (
            <DeveloperIcon developer={developer} className="h-4 w-4 text-accent" />
          )
        )}
        {/* `grow` so a full-width trigger (Settings) pushes the chevron to the
            right edge; in a content-width pill (composer) it is a no-op.
            Under Auto the pill names the active routing preference too —
            "Auto · Balanced" — so the budget the hold-slider adjusts is
            visible at rest, not only inside the sheet. Settings passes no
            preference and keeps the bare "Auto". */}
        <span className="grow truncate text-left">
          {auto
            ? autoPreference
              ? `Auto · ${AUTO_PREFERENCE_LABEL[autoPreference]}`
              : "Auto"
            : targetLabel(value)}
        </span>
        {holdHint && <HoldSliderHint />}
        <PickerChevron />
      </button>
      <TargetPickerSheet
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        value={value}
        auto={offersAuto ? (auto ?? false) : undefined}
        onPickAuto={
          onAutoChange &&
          (() => {
            onAutoChange(true);
            setOpen(false);
          })
        }
        autoPreference={autoPreference}
        streaming={streaming}
        onPickPreference={
          onAutoChange &&
          onAutoPreferenceChange &&
          ((next: AutoPreference) => {
            // Choosing HOW Auto should route is choosing Auto: the dial both
            // stores the preference and turns routing on, one interaction.
            // The sheet stays OPEN — see AutoTuningDial's header.
            onAutoPreferenceChange(next);
            onAutoChange(true);
          })
        }
        onPick={(next) => {
          // Picking a model explicitly is also how you leave Auto — there is
          // no separate "turn it off", because choosing one IS turning it off.
          onAutoChange?.(false);
          onChange(next);
          setOpen(false);
        }}
      />
    </>
  );
}

function TargetPickerSheet({
  open,
  onClose,
  title,
  value,
  onPick,
  auto,
  onPickAuto,
  autoPreference,
  onPickPreference,
  streaming,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  value: TargetModelId;
  onPick: (next: TargetModelId) => void;
  auto?: boolean;
  onPickAuto?: () => void;
  autoPreference?: AutoPreference;
  onPickPreference?: (next: AutoPreference) => void;
  streaming?: boolean;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  // Open on the current pick rather than the top of a sixteen-row list.
  const initialFocus = useMemo(() => selectedRef, []);
  // The radio roles promise arrow keys (A11Y-002). Picking closes the sheet,
  // so arrows move FOCUS only; Enter/Space activates.
  const flatIds = useMemo(
    () => [
      ...(onPickAuto ? ["__auto__"] : []),
      ...GROUPS.flatMap((g) => g.models.map((m) => m.id)),
    ],
    [onPickAuto],
  );
  // The CHECKED index, live — not a starting point. Turning Auto on from the
  // tuning dial re-checks this group's first radio without moving focus, and
  // the sheet no longer closes behind it, so the tab stop has to follow.
  const roving = useRovingRadios(flatIds.length, auto ? 0 : flatIds.indexOf(value));

  return (
    // anchor="side": both picker triggers live mid-screen in the composer
    // rail (and Settings), so the list opens beside them as a centered edge
    // card instead of a bottom sheet a viewport away from the press.
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      initialFocusRef={initialFocus}
      anchor="side"
    >
      <div
        role="radiogroup"
        aria-label={title}
        className="flex flex-col gap-4"
        onKeyDown={roving.onKeyDown}
      >
        {onPickAuto && (
          // Above the developer groups and outside them: Auto is not a model,
          // it is the decision not to pick one. Giving it its own section
          // keeps it out of any developer's list, where it would read as a
          // product they ship.
          <section className="flex flex-col gap-1">
            <div className="glass overflow-hidden rounded-xl">
              <button
                {...roving.radioProps(0, auto ? selectedRef : undefined)}
                type="button"
                role="radio"
                aria-checked={auto ?? false}
                onClick={onPickAuto}
                // py-3 is not redundant with the 44px floor: one text-sm line
                // (20px) + 24px padding IS 44px, so single-line rows don't
                // move — but this row's description wraps, and without the
                // padding the grown content renders flush against the card
                // borders.
                className="font-body flex min-h-[44px] w-full items-center gap-3 px-4 py-3 text-left text-sm text-text transition-colors hover-hair"
              >
                <AutoGlyph className="h-4 w-4 shrink-0 text-accent" />
                <span className="grow">
                  Auto
                  <span className="block text-xs text-silver">
                    Picks a model to suit the mode, length, and attachments
                  </span>
                </span>
                {auto && <CheckGlyph />}
              </button>
            </div>
            {onPickPreference && autoPreference && (
              // Auto's tuning dial, directly under the card it tunes (owner
              // direction, 2026-08-11: the same slider mechanism as Thinking,
              // "underneath the auto selection for model auto tuning",
              // popping out over its own label button, inside the pane that
              // slides out from the right). It replaced a three-up Segmented
              // — same three values, but a preference from Budget to Quality
              // is a RAMP, and the capsule's growing fill says that where
              // three equal cells said only "pick one".
              //
              // The wrapper keeps roving-nav keys out of the enclosing model
              // radiogroup — see ROVING_NAV_KEYS.
              <div
                onKeyDown={(e) => {
                  if (ROVING_NAV_KEYS.has(e.key)) e.stopPropagation();
                }}
              >
                <AutoTuningDial
                  value={autoPreference}
                  onChange={onPickPreference}
                  streaming={streaming ?? false}
                />
              </div>
            )}
          </section>
        )}
        {GROUPS.map((group) => (
          <section key={group.developer} className="flex flex-col gap-1">
            <p className="font-body px-1 text-[0.625rem] uppercase tracking-[0.18em] text-silver">
              {DEVELOPER_LABEL[group.developer]}
            </p>
            <div className="glass flex flex-col divide-y divide-hair overflow-hidden rounded-xl">
              {group.models.map((m) => {
                // Under Auto no model row is the pick — the Auto row is. The
                // fallback id must not render as if the user had chosen it.
                const active = m.id === value && !auto;
                return (
                  <button
                    key={m.id}
                    {...roving.radioProps(
                      flatIds.indexOf(m.id),
                      active ? selectedRef : undefined,
                    )}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onPick(m.id)}
                    className="font-body flex min-h-[44px] items-center gap-3 px-4 py-3 text-left text-sm text-text transition-colors hover-hair"
                  >
                    <DeveloperIcon
                      developer={group.developer}
                      className="h-4 w-4 shrink-0 text-accent"
                    />
                    <span className="grow truncate">{m.label}</span>
                    {active && <CheckGlyph />}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Sheet>
  );
}

/**
 * Auto's routing dial — Budget → Balanced → Quality, as a hold-slider.
 *
 * Same control class as the Thinking rail's (ThinkingDial's header carries
 * the full rationale for the shape): a `role="slider"` button that states its
 * value in that value's ink, expands into the capsule over its own footprint
 * on tap, scrubs under a hold, and steps on the arrow keys. Three stops is a
 * short ladder, which is exactly why the capsule is `fixed` in the owner's
 * sense — it always opens the same size in the same place, over the label.
 *
 * Committing a preference also turns Auto ON, so the dial doubles as the
 * shortcut the Segmented was. What it deliberately does NOT do any more is
 * close the sheet: a segment tap was a discrete choice that ended the
 * interaction, but a dial is something you adjust and look at, and closing
 * the pane out from under a drag threw away the result the user had just
 * dialled in.
 */
function AutoTuningDial({
  value,
  onChange,
  streaming,
}: {
  value: AutoPreference;
  onChange: (next: AutoPreference) => void;
  /** Stands the capsule's focus blur down to dim-only while the composer
   *  behind the sheet is repainting — see TargetPicker's `streaming`. */
  streaming: boolean;
}) {
  const index = BUDGET_DETENTS.findIndex((d) => d.id === value);
  // A stored value outside the ladder can only come from a future/edited
  // persisted state; treat it as the middle stop rather than rendering a
  // slider with no position.
  const selectedIndex = index < 0 ? 1 : index;
  const detent = BUDGET_DETENTS[selectedIndex]!;
  const max = BUDGET_DETENTS.length - 1;

  /**
   * A COMMIT always notifies, even when it lands on the stop already stored
   * (Codex review, PR #109).
   *
   * `onChange` here is not a plain setter — it is the parent's
   * `onPickPreference`, which stores the preference AND turns Auto on. So a
   * "nothing changed, skip it" guard was not the harmless de-duplication it
   * looked like: it silently dropped the second half. The case it broke is
   * the DEFAULT one — Auto off, preference already Balanced, user opens the
   * dial and commits Balanced — where the documented shortcut ("adjusting
   * the dial is choosing Auto", the behaviour the Segmented had) simply did
   * not fire. Deliberately choosing a stop is an act whether or not it moves
   * the value.
   *
   * Re-storing the same preference is genuinely free: the store writes an
   * identical value, so every value-selecting subscriber sees no change.
   */
  const commitIndex = (next: number) => {
    const landed = BUDGET_DETENTS[Math.max(0, Math.min(max, next))];
    if (landed) onChange(landed.id as AutoPreference);
  };

  /** A keyboard step is the one interaction that can fail to be a choice: an
   *  arrow at the end of the ladder moves nothing, and a key that did nothing
   *  visible must not flip a mode. Movement first, then commit. */
  const stepTo = (next: number) => {
    const clamped = Math.max(0, Math.min(max, next));
    if (clamped === selectedIndex) return;
    commitIndex(clamped);
  };

  return (
    <HoldSliderTrigger
      detents={BUDGET_DETENTS}
      selectedIndex={selectedIndex}
      liveLabel={(d) => `Auto · ${d.label}`}
      onCommit={commitIndex}
      enabled
      latchOnTap
      peakCaption={BUDGET_PEAK_CAPTION}
      dynamicBackdrop={streaming}
      // Block-level here: this dial spans the sheet's column under the card
      // it tunes, unlike the composer rail's content-width pills — which is
      // exactly why it also declares `scrollableHost`: a full-width band
      // across an overflowing sixteen-row list would otherwise swallow the
      // pan that scrolls it.
      className="flex w-full"
      scrollableHost
    >
      <button
        type="button"
        role="slider"
        aria-label="Auto routing preference"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={selectedIndex}
        aria-valuetext={detent.label}
        onKeyDown={(e) => {
          let next: number | null = null;
          if (e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "PageUp") {
            next = selectedIndex + 1;
          } else if (
            e.key === "ArrowLeft" ||
            e.key === "ArrowDown" ||
            e.key === "PageDown"
          ) {
            next = selectedIndex - 1;
          } else if (e.key === "Home") {
            next = 0;
          } else if (e.key === "End") {
            next = max;
          }
          if (next === null) return;
          e.preventDefault();
          stepTo(next);
        }}
        className="font-body flex min-h-[44px] w-full items-center gap-2 rounded-xl bg-surface px-4 py-1.5 text-sm text-text"
      >
        <span className="text-[0.625rem] uppercase tracking-[0.18em] text-silver">
          Routing
        </span>
        <span className={`grow text-right ${TONE_INK_CLASS[detent.tone]}`}>
          {detent.label}
        </span>
        <HoldSliderHint />
      </button>
    </HoldSliderTrigger>
  );
}

/** Auto's mark. Deliberately not any developer's glyph — Auto is the decision
 *  not to pick one, so borrowing a vendor mark would misdescribe it. Two
 *  converging paths: several models, one route. */
function AutoGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path
        d="M4 6h4c4 0 4 12 8 12h4M4 18h4c4 0 4-12 8-12h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

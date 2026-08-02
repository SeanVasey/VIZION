"use client";

import { memo, useMemo, useRef, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { CheckGlyph } from "@/components/ui/CheckGlyph";
import { useRovingRadios } from "@/components/models/use-roving-radios";
import { THINKING_LEVEL_LABEL, type ThinkingLevel } from "@/lib/constants";

/**
 * Reasoning-depth picker — trigger + sheet, and deliberately NOT a `<select>`.
 *
 * WHY NOT A SELECT. Thinking sits in the rail directly under Target, so the two
 * controls are read as a pair — and a native `<select>` cannot join that pair at
 * the designed size. globals.css floors `input, select, textarea` at 16px on iOS
 * (inside the `-webkit-touch-callout` gate) because Safari zooms the whole page
 * when a focused control computes under 16px and rarely zooms back out. The
 * floor is `!important` and out-specifies `text-sm`, so the select rendered its
 * "Auto" a full 2px larger than the Target pill's "Auto" one row above it — a
 * mismatch that is invisible in CI (the gate is iOS-only by construction; see
 * docs/runbooks/ios-verification.md) and unmissable on a phone.
 *
 * A button leaves the rule's scope entirely, which is the same move TargetPicker
 * made for the same reason. Both triggers now take ONE class string from the
 * composer, so the pills cannot drift apart again.
 *
 * The trade is the native picker wheel, and the ladders are short enough
 * (three to five steps plus Auto) that the sheet is no worse a fit — it also
 * buys the room to say what Auto actually does, which an `<option>` cannot.
 */
// Memoized: like TargetPicker, nested in the composer. Its `onChange` is now a
// useCallback in the composer, so all props are stable and the memo holds
// across stream flushes (PERF-006).
export const ThinkingPicker = memo(ThinkingPickerImpl);

function ThinkingPickerImpl({
  value,
  options,
  onChange,
  label,
  triggerClassName,
}: {
  /** The chosen level, or undefined for Auto (send nothing). */
  value: ThinkingLevel | undefined;
  /** The selected target's ladder, in ascending order. */
  options: readonly ThinkingLevel[];
  /** `null` clears back to Auto — the store's own "no level" signal. */
  onChange: (next: ThinkingLevel | null) => void;
  /** Accessible name for the trigger, e.g. "Thinking depth". */
  label: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={
          triggerClassName ??
          "font-body inline-flex min-h-[44px] items-center gap-2 rounded-full bg-surface py-1.5 pl-3 pr-2.5 text-sm text-text"
        }
      >
        <span className="sr-only">{label}: </span>
        <DepthGlyph className="h-4 w-4 shrink-0 text-silver" />
        {/* `grow` mirrors the target trigger so a full-width variant would push
            the chevron to the edge; in the composer's content-width pill it is
            a no-op. */}
        <span className="grow truncate text-left">
          {value ? THINKING_LEVEL_LABEL[value] : "Auto"}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0 text-silver"
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
      </button>
      <ThinkingPickerSheet
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        value={value}
        options={options}
        onPick={(next) => {
          onChange(next);
          setOpen(false);
        }}
      />
    </>
  );
}

function ThinkingPickerSheet({
  open,
  onClose,
  title,
  value,
  options,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  value: ThinkingLevel | undefined;
  options: readonly ThinkingLevel[];
  onPick: (next: ThinkingLevel | null) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  // Open on the current pick, not the top of the ladder.
  const initialFocus = useMemo(() => selectedRef, []);
  const isAuto = value === undefined;
  // Arrow-key focus per the radio contract (A11Y-002); Enter/Space picks.
  const roving = useRovingRadios(
    options.length + 1,
    isAuto ? 0 : options.indexOf(value) + 1,
  );

  return (
    // anchor="side": the trigger pill sits mid-screen in the composer rail,
    // so the picker docks beside it rather than a viewport away at the
    // bottom edge (same call as TargetPicker — the pair must match).
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
        {/* Auto is not a depth — it is the decision not to set one, which sends
            no level at all and leaves the provider's own default in place. Its
            own section keeps it out of the ladder, where it would read as a
            step between Low and Minimal. */}
        <section className="flex flex-col gap-1">
          <div className="glass overflow-hidden rounded-xl">
            <button
              {...roving.radioProps(0, isAuto ? selectedRef : undefined)}
              type="button"
              role="radio"
              aria-checked={isAuto}
              onClick={() => onPick(null)}
              className="font-body flex min-h-[44px] w-full items-center gap-3 px-4 text-left text-sm text-text transition-colors hover-hair"
            >
              <DepthGlyph className="h-4 w-4 shrink-0 text-silver" />
              <span className="grow">
                Auto
                <span className="block text-xs text-silver">
                  Uses the model&apos;s own default depth
                </span>
              </span>
              {isAuto && <CheckGlyph />}
            </button>
          </div>
        </section>
        <section className="flex flex-col gap-1">
          <p className="font-body px-1 text-[0.625rem] uppercase tracking-[0.18em] text-silver">
            Depth
          </p>
          <div className="glass flex flex-col divide-y divide-hair overflow-hidden rounded-xl">
            {options.map((level) => {
              const active = level === value;
              return (
                <button
                  key={level}
                  {...roving.radioProps(
                    options.indexOf(level) + 1,
                    active ? selectedRef : undefined,
                  )}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onPick(level)}
                  className="font-body flex min-h-[44px] items-center gap-3 px-4 text-left text-sm text-text transition-colors hover-hair"
                >
                  <span className="grow truncate">{THINKING_LEVEL_LABEL[level]}</span>
                  {active && <CheckGlyph />}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </Sheet>
  );
}

/** Depth's category mark — a rising meter. Static by design: it names the
 *  control the way the developer mark names the target, and is not a readout
 *  of the chosen step (the label beside it is). */
function DepthGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path
        d="M6 19v-4M12 19v-8M18 19V7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

"use client";

import { useUIStore } from "@/stores/ui";

/**
 * The dials' one-time how-to line (owner request, 2026-08-11: "a small help
 * notification for ease of use").
 *
 * It exists because ADR-0014 traded a visible affordance for an invisible
 * one. The chevron the Thinking pill used to wear was a lie — there was no
 * dropdown — but it was a legible lie: it said "this opens". The grip ticks
 * that replaced it say "this slides" to anyone who already knows the
 * vocabulary, and nothing at all to anyone who does not. This line is what
 * pays that debt, and it is deliberately the cheapest possible form of
 * payment: one sentence of muted body copy in the rail's own column, no
 * card, no scrim, no arrow, nothing that has to be positioned against a
 * moving target or dismissed before the app is usable.
 *
 * It retires ITSELF. `dialTipSeen` flips the first time any dial commits a
 * value (the composer's commit handlers), so the tip is gone the moment it
 * has been proven unnecessary — a user who worked the control out
 * immediately never sees it twice. The explicit "Got it" is for the user who
 * read it and does not want to; both routes write the same flag.
 *
 * Device-local like the other preference flags: it is a hint, not identity,
 * and a stale one costs nothing (worst case a second device shows a sentence
 * once more).
 */
export function DialCoachTip() {
  const seen = useUIStore((s) => s.dialTipSeen);
  const setSeen = useUIStore((s) => s.setDialTipSeen);
  if (seen) return null;

  return (
    <p
      data-dial-coach-tip=""
      // min-h-44 is the DISMISS BUTTON's doing, not the text's. `tap-44`
      // centres its 44px pseudo-element on a ~15px line, so it overhangs
      // ~14px in each direction — and this row sits `gap-1` (4px) under the
      // Thinking rail with the button right-aligned, directly beneath the
      // dial. The overhang therefore reached about 10px up into the dial's
      // lower edge, right where the grip is: tapping to open the slider
      // dismissed the tip instead (Codex review, PR #109). Giving the row
      // the button's own target height contains the pseudo inside it.
      // `items-start` keeps the glyph on the first text line; the button
      // centres itself (see below), which is what puts its hit area in the
      // middle of the reserved space rather than at the top of it.
      className="font-body flex min-h-[44px] items-start gap-2 pr-1 text-[0.6875rem] leading-snug text-silver"
    >
      <SlideGlyph className="mt-[2px] h-3.5 w-3.5 shrink-0 text-silver" />
      <span className="grow">
        Tap a dial to open its slider — or press and hold to slide straight to a
        level.
      </span>
      <button
        type="button"
        onClick={() => setSeen(true)}
        // The 44px floor applies to the TAP TARGET, not the ink: the label is
        // one small word by design (it must not out-shout the tip it
        // dismisses). `tap-44` is the repo's extender for exactly that — a
        // pseudo-element sized `max(100%, 44px)` on both axes, centred on the
        // button, which grows the HIT AREA without touching layout.
        //
        // The first cut tried to do it with `py-3` plus a negative margin and
        // fell short in both directions (Codex review, PR #109): an 11px
        // leading-snug line plus 24px of padding is ~39px, not 44, the word
        // sets no minimum width at all, and a negative margin moves the box
        // rather than extending what hit-testing sees.
        className="tap-44 shrink-0 self-center pl-2 font-medium text-accent transition-colors hover:text-chalk"
      >
        Got it
      </button>
    </p>
  );
}

/** A track with a thumb on it — the gesture the sentence describes, drawn.
 *  Decorative: the sentence beside it is the message. */
function SlideGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path
        d="M3 12h18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="15" cy="12" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

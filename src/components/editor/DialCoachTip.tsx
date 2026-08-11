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
      className="font-body flex items-start gap-2 pr-1 text-[0.6875rem] leading-snug text-silver"
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
        // dismisses), so the target is grown with padding and a negative
        // margin that keeps the row's own height unchanged.
        className="-my-3 shrink-0 py-3 pl-2 font-medium text-accent transition-colors hover:text-chalk"
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

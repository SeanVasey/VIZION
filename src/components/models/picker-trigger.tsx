/**
 * The Target trigger's shared pieces (the pills "must match" — see
 * ThinkingDial's pairing notes). TargetPicker normally receives
 * `triggerClassName` from its host (the composer's RAIL_TRIGGER_CLASS, or
 * Settings' full-width variant); the fallback below exists for prop-less
 * renders (the unit suites) and lives here once so the pair cannot drift.
 *
 * The CHEVRON is now Target's alone (ADR-0014). It stays because Target
 * genuinely opens a list — sixteen models across twelve developers — while
 * the Thinking dial, which opens a slider, trades it for the grip. That is
 * the whole rule the owner set: a control looks like a dropdown only if it
 * is one. Keep this glyph out of any control that does not open a menu.
 */
export const PICKER_TRIGGER_FALLBACK_CLASS =
  "font-body inline-flex min-h-[44px] items-center gap-2 rounded-full bg-surface py-1.5 pl-3 pr-2.5 text-sm text-text";

/** The pair's disclosure chevron — one markup, two consumers (INV-06 SVG
 *  glyph language; decorative, each trigger carries its own text). */
export function PickerChevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-silver">
      <path
        d="M8 10l4 4 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

# 12. The hold-slider: a press-and-hold drag accelerator over a tap trigger

Date: 2026-08-09
Status: accepted (extends [0004](./0004-audit-design-rulings.md)'s slider
ruling, DSN-022); amended same day after the first on-device pass — see
below

## Context

Owner direction, with a reference recording of ChatGPT's iOS composer: its
reasoning-effort gauge expands under a press-and-hold into an inline capsule
track with detent dots and a live label, and the same unbroken gesture drags
between detents; release commits. VIZION's equivalents — the Thinking rail's
depth ladder and Auto-routing's budget preference — were tap-to-open sheets
only: complete and accessible, but two taps and a reorientation for what is,
on a phone, a one-thumb adjustment.

[0004] already ruled that a slider is a distinct control class, exempt from
the text-input recipe. That ruling covered _plain_ sliders (native ranges:
avatar zoom, the developer-accent dial). This decision covers a new member of
the class with a stricter shape: a **pointer-only accelerator layered over an
existing tap trigger**.

## Decision

`useHoldDrag` (`src/components/ui/use-hold-drag.ts`) +
`HoldSliderTrigger`/`HoldSliderOverlay` (`src/components/ui/HoldSlider.tsx`),
with these properties fixed:

- **Tap is untouched; hold is extra.** The wrapped pill keeps its
  `button`/`aria-haspopup` semantics and its sheet. The sheet is the single
  complete path — keyboard, screen reader, and discovery all live there —
  which is what satisfies WCAG 2.5.7's single-pointer alternative. The hold
  gesture is an accelerator in exactly the sense the library's swipe actions
  are: a faster route to a destination that exists without it.
- **The overlay is decoration, not a widget.** It renders `aria-hidden` with
  `pointer-events: none`, portalled to `<body>` (the composer chassis is
  `overflow-hidden` and would clip it). It is deliberately NOT
  `role="slider"`: it exists only mid-gesture and cannot take focus, and a
  slider role that no keyboard can ever reach would be a lie to the
  accessibility tree. The committed value is announced through an
  always-mounted polite live region, and the pill label remains the
  authoritative readout.
- **Two-phase axis claim.** At rest the wrapper claims
  `touch-action: pan-y pinch-zoom` (the lessons.md rule — never `none`);
  once the hold fires, the pointer is captured and a non-passive window
  `touchmove` preventDefault holds the line against a late vertical pan.
  Disabled wrappers make no claim at all. _(Superseded by the amendment
  below: the resting claim is now `pinch-zoom`.)_
- **Hold timing:** 300ms — above `usePressable`'s 130ms press floor so a
  decisive tap stays a tap, below the ~500ms system long-press so the iOS
  callout never races the overlay (callout and context menu are additionally
  suppressed, but only while a gesture is live).
- **Detents are 44px apart** (one touch target each), the selected detent is
  anchored under the finger at expansion, and geometry is a pure function of
  the pointer-down x — which is what makes the gesture unit-testable in a
  layoutless DOM.
- **Tone ramp** rides the detent, keyed to the level's identity, never its
  ladder position: `faint`/`silver` (muted mixes) → `laser` (fill-safe both
  themes) → `ultra` (the xhigh/max violet the depth meter already wears).
  The fill never carries ink; `--ultra-ink`'s role comment now records the
  text-free-fill allowance.
- **Mouse is included.** Desktop users get the same accelerator, and it is
  what lets Playwright drive the gesture in CI.

## Consequences

- The composer rails wire it around the existing pickers with zero new
  picker props, so the memo contracts (PERF-006) and the matched-pair
  trigger-class test keep holding.
- Haptic ticks ride detent changes on engines that implement vibration; on
  iOS they are a documented no-op and the visual fill snap is the feedback
  (the standing "never simulate" ruling).
- Hold behaviour on real iOS (callout suppression, mid-drag pointercancel)
  cannot be verified by the WebKitGTK e2e project — it is on the manual list
  in `docs/runbooks/ios-verification.md`.

## Amendment (2026-08-09): the pre-hold window

The first on-device pass failed the same day this landed: on an iPhone the
slider did not display at all — a press produced either nothing or the tap
sheet. Two independent defects lived in the PRE-HOLD window, the one phase
no suite exercised (the mouse e2e waits out the hold before moving; the
unit tests dispatch the events the implementation expects). Either alone
reads as a dead control; both are repaired:

1. **The slop rule discarded the reference gesture.** The recording this
   control is modeled on engages under press-and-slide — one unbroken
   motion, no stationary pause. The shipped rule classified >10px of
   pre-hold movement on _either_ axis as not-this-control and quietly
   swallowed the press (no overlay, and deliberately no sheet). Repair:
   pre-hold movement past slop now **activates** the track when x-dominant
   — the slide _is_ the gesture, on the axis the wrapper always reserved —
   and stands down only when y-dominant (scroll intent, unchanged).
2. **`pan-y` granted the UA the means to kill the press.** `touch-action`
   is consulted once, at gesture start (the two-phase-claim lesson), so the
   resting value is the pre-hold window's only defense — and `pan-y
pinch-zoom` left the UA free to read a pre-hold vertical drift as a pan
   and end the press with `pointercancel` (MDN documents `pointercancel`
   firing once the pointer starts manipulating the viewport). Repair: the
   resting claim narrows to **`pinch-zoom`** — zoom stays native (the WCAG
   guard in zoom-and-share), while single-finger pans starting on the two
   composer pills belong to the gesture. The library's swipe rows rightly
   keep `pan-y`: a full-width list row IS the scroll surface; a ~44px pill
   is not. `none` stays banned.

Verified under real synthesized touch in Chromium (CDP drives the actual
gesture recognizer: touch-action consultation, pointer derivation, click
synthesis): press-and-slide engages and commits, a stationary hold expands,
a quick tap still opens the sheet — `tests/e2e/authed.spec.ts` "under
touch", Chromium-only. Which of the two defects the owner's device hit is
not established and does not need to be; real-iOS confirmation of the
repaired gesture stays on the manual list in
`docs/runbooks/ios-verification.md`.

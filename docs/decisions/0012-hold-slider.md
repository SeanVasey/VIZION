# 12. The hold-slider: a press-and-hold drag accelerator over a tap trigger

Date: 2026-08-09
Status: accepted (extends [0004](./0004-audit-design-rulings.md)'s slider
ruling, DSN-022)

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
  Disabled wrappers make no claim at all.
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

/**
 * On-screen-keyboard detection heuristic (visual-viewport template).
 *
 * iOS never resizes the *layout* viewport when the software keyboard opens, so
 * `position: fixed; bottom: 0` chrome stays glued to a bottom edge that is now
 * behind the keyboard — and once the user scrolls, WebKit re-anchors it
 * mid-screen over whatever content is there (the floating-bottom-nav bug).
 * The *visual* viewport, however, does shrink; comparing the two heights is
 * the standard keyboard signal, and the bottom nav hides itself while it fires.
 *
 * Like `safe-area.ts`, this module is pure math over a sampled viewport state —
 * nothing here touches the DOM, so the heuristic is unit-testable in isolation.
 */

/**
 * Height loss (CSS px) beyond which we call the shrink "a keyboard".  Safari's
 * collapsing toolbars move the layout viewport itself (both heights change
 * together), so genuine keyboard overlaps start well above this; the smallest
 * iOS keyboards are ~260px.
 */
export const KEYBOARD_MIN_OVERLAP = 150;

/** Pinch-zoom also shrinks the visual viewport; above this scale it never
 *  indicates a keyboard. Slack absorbs floating-point scale readouts. */
const MAX_UNZOOMED_SCALE = 1.01;

interface ViewportSample {
  /** `window.innerHeight` — the layout viewport height. */
  layoutHeight: number;
  /** `visualViewport.height` — the visible height in CSS px at current scale. */
  visualHeight: number;
  /** `visualViewport.scale` — the pinch-zoom factor (1 = unzoomed). */
  scale: number;
  /** `visualViewport.offsetTop` — how far the visual viewport has slid down
   *  the layout viewport (WebKit shifts it when scrolling a focused field into
   *  view). Absent = 0. */
  offsetTop?: number;
}

/** True when the sampled viewport state indicates an open software keyboard. */
export function isKeyboardViewport(sample: ViewportSample): boolean {
  if (sample.scale > MAX_UNZOOMED_SCALE) return false;
  return sample.layoutHeight - sample.visualHeight > KEYBOARD_MIN_OVERLAP;
}

/**
 * CSS px between the layout viewport's bottom edge and the visible area's —
 * i.e. how tall the keyboard's occlusion is right now. A `position: fixed`
 * element anchors to the LAYOUT viewport, so `bottom: keyboardInset(...)px`
 * is what lands it exactly on top of the keyboard instead of behind it.
 *
 * Zero whenever no keyboard is detected (including pinch-zoom shrink), so a
 * consumer can use the number alone as its show/hide signal.
 */
export function keyboardInset(sample: ViewportSample): number {
  if (!isKeyboardViewport(sample)) return 0;
  const occluded =
    sample.layoutHeight - sample.visualHeight - (sample.offsetTop ?? 0);
  return Math.max(0, Math.round(occluded));
}

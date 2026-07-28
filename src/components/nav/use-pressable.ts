"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A tap can be shorter than the eye can resolve — a decisive thumb is down and
 * up inside ~60ms, which is under four frames. Hold the pressed look for at
 * least this long after pointer-down so a quick tap still *reads* as pressed
 * rather than flickering.
 */
const MIN_HOLD_MS = 130;

/** Haptic tick on press — short enough to feel like a click, not a buzz. */
const TICK_MS = 8;

/**
 * Explicit press state for a control, driven by pointer events rather than
 * CSS `:active`.
 *
 * Two reasons it is not just `active:` utilities:
 *
 *  1. **iOS Safari only applies `:active` when the document carries a touch
 *     listener.** `InteractionManager` installs one globally so the app's
 *     existing `active:` utilities work at all, but a nav tab is the app's
 *     most-tapped control and deserves state we can assert on in a test rather
 *     than a platform quirk we hope is still true next release.
 *  2. **`:active` ends the instant the finger lifts.** On a fast tap that is
 *     ~60ms of feedback. The minimum-hold below is not expressible in CSS.
 *
 * Also fires a short haptic tick on touch/pen presses (no-op on iOS, which
 * does not implement the Vibration API, and skipped for mouse, where there is
 * nothing to vibrate).
 */
export function usePressable() {
  const [pressed, setPressed] = useState(false);
  const downAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const press = useCallback((haptic: boolean) => {
    clearTimeout(timer.current);
    downAt.current = Date.now();
    setPressed(true);
    // Optional chaining on the method AND a feature test on the object: the
    // property is absent on iOS/desktop Safari and present-but-inert
    // elsewhere, and `navigator` itself is absent in a non-DOM test env.
    if (haptic) navigator?.vibrate?.(TICK_MS);
  }, []);

  const release = useCallback(() => {
    clearTimeout(timer.current);
    const held = Date.now() - downAt.current;
    if (held >= MIN_HOLD_MS) {
      setPressed(false);
      return;
    }
    timer.current = setTimeout(() => setPressed(false), MIN_HOLD_MS - held);
  }, []);

  return {
    pressed,
    /**
     * Spread onto the control. Pointer events cover touch, pen and mouse in
     * one set; the keyboard pair gives a keyboard user the same affordance the
     * focus ring cannot carry (that the key press *registered*).
     */
    handlers: {
      // Opt-IN, not "anything that isn't a mouse": an input device we can't
      // identify is not one we should be buzzing.
      onPointerDown: (e: React.PointerEvent) =>
        press(e.pointerType === "touch" || e.pointerType === "pen"),
      onPointerUp: release,
      // A pointer the scroller claims mid-gesture, or one dragged off the
      // control, is a cancelled press — release it or the tab stays lit.
      onPointerCancel: release,
      onPointerLeave: release,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") press(false);
      },
      onKeyUp: release,
      onBlur: release,
    },
  };
}

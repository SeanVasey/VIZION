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
 * Two reasons it is not just an `active:` utility, both of which are about
 * what `:active` *cannot do*, not about any platform bug:
 *
 *  1. **`:active` ends the instant the finger lifts.** A tap is ~40–100ms, so
 *     the feedback lasts ~40–100ms and can be gone before it is seen. The
 *     minimum-hold below is not expressible in CSS at all.
 *  2. **It is state, so a test can assert on it.** The nav is the app's
 *     most-tapped control; `[data-pressed]` is checkable in a unit test,
 *     whereas a pseudo-class needs a real engine and a held pointer.
 *
 * Also fires a short haptic tick on touch/pen presses — skipped for mouse,
 * where there is nothing to vibrate, and a no-op on iOS, which does not
 * implement the Vibration API.
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

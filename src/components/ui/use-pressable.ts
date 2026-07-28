"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { tap } from "@/lib/haptics";

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
 * Explicit press state for a control, driven by pointer events. Pair with the
 * `.pressable` class (globals.css), which owns the instant-down / eased-up
 * scale that `[data-pressed]` drives.
 *
 * **This is what keeps the app off `:active` for touch feedback, deliberately.**
 * Every source on the subject — Apple's (archived) Safari Web Content Guide
 * included — reports that iOS ignores `:active` for touch unless the document
 * carries a touch listener, and that the documented workaround has a real cost:
 * a global `touchstart` listener makes elements flash active *while you
 * scroll past them*. That reporting is also uniformly ancient, and it could
 * not be verified here (Playwright's Linux WebKit applies `:active` either
 * way, and cannot hold a touch). Rather than bet the app's feedback on a
 * behaviour nobody can currently confirm, nothing depends on it: state we set
 * ourselves renders identically on every engine.
 *
 * Two things `:active` could not give us regardless:
 *
 *  1. **It ends the instant the finger lifts.** A tap is ~40–100ms, so the
 *     feedback lasts ~40–100ms. `MIN_HOLD_MS` is not expressible in CSS.
 *  2. **A press dragged off the control never cancels** (a long-standing iOS
 *     complaint). `onPointerLeave` / `onPointerCancel` below do.
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
    // lib/haptics is capability-detected and a documented no-op on iOS, which
    // has never implemented the Vibration API.
    if (haptic) tap(TICK_MS);
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
      // control, is a cancelled press — release it or the control stays lit.
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

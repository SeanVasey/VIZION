"use client";

import { useEffect } from "react";

/**
 * How long after the last scroll event the page is considered still again.
 * Long enough to bridge the gap between two flicks of a momentum scroll, short
 * enough that the glass is back before the eye settles on it.
 */
const SETTLE_MS = 140;

/**
 * Stamps `data-scrolling` on `<html>` while the page is moving. Renders nothing.
 *
 * ONE consumer remains: `[data-scrolling] .fab-glass::before` (globals.css),
 * which stands the FAB's backdrop blur down mid-scroll — the FAB is fixed
 * over the list, so its snapshot region re-blurs every frame of every
 * scroll, and its 82%-Laser fill makes the swap genuinely invisible.
 *
 * `.glass` panels are deliberately NOT wired to this attribute. Two
 * generations of a panel stand-down were falsified on device (2026-08):
 * blur-off made panels see-through mid-flick, and an opaque fill swap made
 * the library/settings greys visibly shift with every gesture. Panels now
 * render identically in motion and at rest — see the scroll-gate comment in
 * globals.css before wiring anything else to this attribute.
 *
 * The listener is passive, so it cannot delay a scroll frame.
 */
export function ScrollStateManager() {
  useEffect(() => {
    const root = document.documentElement;

    let settle: ReturnType<typeof setTimeout> | undefined;
    let moving = false;

    const still = () => {
      moving = false;
      delete root.dataset.scrolling;
    };

    const onScroll = () => {
      // Writing the attribute invalidates style for the whole document, so do
      // it once per gesture, not once per event.
      if (!moving) {
        moving = true;
        root.dataset.scrolling = "";
      }
      clearTimeout(settle);
      settle = setTimeout(still, SETTLE_MS);
    };

    // `capture` so scrolls inside nested scrollers (sheets, the composer, the
    // crop modal) are seen too — scroll events do not bubble past their target.
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });

    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      clearTimeout(settle);
      still();
    };
  }, []);

  return null;
}

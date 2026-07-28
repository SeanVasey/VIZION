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
 * Frosted glass is expensive to MOVE: every `.glass` panel makes the compositor
 * snapshot the pixels behind it, blur them and re-composite — every frame, for
 * every panel, and a library screen can hold a dozen. At rest that cost buys
 * the design; in motion it buys nothing, because a backdrop sliding past at
 * flick speed is already a blur. The attribute lets `globals.css` stand that
 * work down while the page moves and bring it back the moment it stops.
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

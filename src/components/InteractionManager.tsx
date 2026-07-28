"use client";

import { useEffect } from "react";

/**
 * How long after the last scroll event the page is considered still again.
 * Long enough to bridge the gap between two flicks of a momentum scroll, short
 * enough that the glass is back before the eye settles on it.
 */
const SETTLE_MS = 140;

/**
 * Root-level touch + scroll tuning. Renders nothing.
 *
 * **1. `:active` on iOS.** WebKit only applies `:active` styles to an element
 * when the document has at least one touch listener attached — an ancient
 * heuristic for "this page expects touch". Without one, every `active:`
 * utility in the app (nav tabs, the header back chevron, buttons) is silently
 * dead on the one platform this PWA targets first, and a tap looks like
 * nothing happened. A single passive no-op listener on `document` is the
 * standard, zero-cost opt-in.
 *
 * **2. `data-scrolling` on `<html>`.** Frosted glass is expensive to move:
 * every `.glass` panel makes the compositor snapshot, blur and re-composite
 * whatever is behind it, *per frame*, and a library screen can hold a dozen of
 * them. At rest that cost buys the design; in motion it buys nothing, because
 * a blurred backdrop sliding past at speed is indistinguishable from an
 * unblurred one. The attribute lets `globals.css` stand that work down while
 * the page is moving and bring it back the moment it stops.
 *
 * Both listeners are passive, so neither can delay a scroll frame.
 */
export function InteractionManager() {
  useEffect(() => {
    const root = document.documentElement;

    const enableActiveStyles = () => {};
    document.addEventListener("touchstart", enableActiveStyles, { passive: true });

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
      document.removeEventListener("touchstart", enableActiveStyles);
      window.removeEventListener("scroll", onScroll, { capture: true });
      clearTimeout(settle);
      still();
    };
  }, []);

  return null;
}

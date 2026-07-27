"use client";

import { useSyncExternalStore } from "react";
import { keyboardInset } from "@/lib/pwa/keyboard";

/**
 * How many CSS px the software keyboard currently occludes at the bottom of
 * the LAYOUT viewport — the DOM-facing half of `keyboardInset`.
 *
 * Subscribes to `visualViewport` **resize and scroll**: WebKit slides the
 * visual viewport (a scroll event, not a resize) when it scrolls a focused
 * field into view, and a bar pinned with a stale inset is exactly the
 * floating-chrome bug `lib/pwa/keyboard.ts` exists to prevent.
 *
 * 0 on desktop, on jsdom (no `visualViewport`), and on the server, so
 * hydration matches and consumers can treat 0 as "no keyboard".
 */

function subscribe(onChange: () => void): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  vv.addEventListener("resize", onChange);
  vv.addEventListener("scroll", onChange);
  return () => {
    vv.removeEventListener("resize", onChange);
    vv.removeEventListener("scroll", onChange);
  };
}

function getSnapshot(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  return keyboardInset({
    layoutHeight: window.innerHeight,
    visualHeight: vv.height,
    scale: vv.scale,
    offsetTop: vv.offsetTop,
  });
}

export function useKeyboardInset(): number {
  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}

"use client";

import { useSyncExternalStore } from "react";
import { isKeyboardViewport } from "@/lib/pwa/keyboard";

/**
 * True while the software keyboard is (heuristically) open — the DOM-facing
 * half of `lib/pwa/keyboard.ts`.  Subscribes to `visualViewport` resizes; on
 * desktop browsers and jsdom (no `visualViewport`, or no height loss) it is
 * constantly false, and the server snapshot is false so hydration matches.
 */

function subscribe(onChange: () => void): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  vv.addEventListener("resize", onChange);
  return () => vv.removeEventListener("resize", onChange);
}

function getSnapshot(): boolean {
  const vv = window.visualViewport;
  if (!vv) return false;
  return isKeyboardViewport({
    layoutHeight: window.innerHeight,
    visualHeight: vv.height,
    scale: vv.scale,
  });
}

export function useKeyboardVisible(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

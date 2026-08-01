"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";

/**
 * Roving tabindex + arrow-key focus for a radiogroup whose SELECTION has side
 * effects (audit A11Y-002 — the picker sheets close on pick, so arrows move
 * FOCUS only and Enter/Space activates, per the ARIA authoring note for
 * radios where selection is expensive). ModeRig keeps its own select-on-arrow
 * variant — there, selection is free.
 */
export function useRovingRadios(count: number, initialIndex: number) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState(initialIndex < 0 ? 0 : initialIndex);

  function onKeyDown(e: KeyboardEvent) {
    const last = count - 1;
    let next: number;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = focusIndex >= last ? 0 : focusIndex + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = focusIndex <= 0 ? last : focusIndex - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    e.preventDefault();
    setFocusIndex(next);
    refs.current[next]?.focus();
  }

  /** Spread onto each radio; `alsoRef` lets a caller keep its own ref (the
   *  sheet's initial-focus target) on the same element. */
  function radioProps(
    index: number,
    alsoRef?: React.MutableRefObject<HTMLButtonElement | null>,
  ) {
    return {
      tabIndex: index === focusIndex ? 0 : -1,
      ref: (el: HTMLButtonElement | null) => {
        refs.current[index] = el;
        if (alsoRef) alsoRef.current = el;
      },
      onFocus: () => setFocusIndex(index),
    };
  }

  return { onKeyDown, radioProps };
}

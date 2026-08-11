"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

/**
 * Roving tabindex + arrow-key focus for a radiogroup whose SELECTION has side
 * effects (audit A11Y-002 — arrows move FOCUS only and Enter/Space activates,
 * per the ARIA authoring note for radios where selection is expensive).
 * ModeRig keeps its own select-on-arrow variant — there, selection is free.
 *
 * `selectedIndex` is the CHECKED radio, and the roving tab stop FOLLOWS it.
 * That tracking is not decoration: WAI-ARIA puts the group's single tab stop
 * on the checked radio, so a selection that changes without moving focus must
 * drag the tab stop with it, or Tab re-enters the group on an unchecked row.
 *
 * It used to be an initial value only, and that was sound while every
 * selection here closed its sheet — this hook's own note said so. ADR-0014
 * ended that: the Target sheet now STAYS OPEN when the tuning dial turns Auto
 * on, which checks the Auto radio from a control outside the group without
 * touching focus (Codex review, PR #109). Arrow navigation is unaffected,
 * because it moves focus without changing the selection.
 */
export function useRovingRadios(count: number, selectedIndex: number) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState(selectedIndex < 0 ? 0 : selectedIndex);
  // After commit, deliberately, and NOT the render-phase adjustment the Sheet
  // uses for `prevOpen`: that pattern was tried here first and lost the update
  // (React re-runs the component for a render-phase setState and a subsequent
  // parent render replayed this one from committed state, landing the tab stop
  // back on the old row). A frame is the right granularity anyway — nothing
  // can Tab between paint and effect, so there is no window to protect.
  useEffect(() => {
    if (selectedIndex >= 0) setFocusIndex(selectedIndex);
  }, [selectedIndex]);

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

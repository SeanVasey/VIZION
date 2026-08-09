"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { tap } from "@/lib/haptics";

/**
 * Press-and-hold → drag-between-detents, in one continuous gesture
 * (docs/decisions/0012-hold-slider.md).
 *
 * This is the accelerator half of a two-path control: a plain TAP falls
 * through to the wrapped trigger's own click (the sheet — the complete,
 * discoverable path), while holding past HOLD_MS expands an overlay track
 * and the same unbroken pointer drags between detents; release commits.
 * The overlay is pointer-transparent decoration — this hook owns the whole
 * gesture from the wrapper element.
 *
 * The gesture is claimed in two phases, extending the axis-claim rule
 * (tasks/lessons.md, 2026-07): before the hold fires, `touch-action:
 * pan-y pinch-zoom` leaves vertical scroll native and only reserves the
 * horizontal axis; once the hold fires the pointer is captured AND a
 * non-passive window `touchmove` preventDefault stops a late vertical pan
 * from stealing the pointer mid-drag. `touch-action: none` at rest is
 * never acceptable (it disabled pinch-zoom app-wide once already).
 */

/** Hold time before the slider engages. Above usePressable's 130ms press
 *  floor (a decisive tap must stay a tap), below the ~500ms system
 *  long-press so the iOS callout never races the overlay. */
export const HOLD_MS = 300;
/** Movement past which a pre-hold press is a scroll, not a hold —
 *  matches use-swipe-actions' INTENT_PX. */
export const SLOP_PX = 10;
/** Horizontal travel per detent — one 44px touch target each. */
export const DETENT_SPACING_PX = 44;
/** Inset from the capsule's rounded end to the first/last detent center. */
export const TRACK_PAD_PX = 22;
/** Rendered height of the overlay capsule. */
export const TRACK_HEIGHT_PX = 48;
/** Minimum gap between the track and the viewport edges. */
export const EDGE_MARGIN_PX = 16;

export interface TrackGeometry {
  /** Viewport-fixed capsule box. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Viewport x of each detent's center, ascending. */
  detentCenters: number[];
}

/**
 * Where the overlay track lands, PURE and exported: jsdom has no layout, so
 * detent mapping must derive from the pointer-down x and these constants,
 * never from measuring rendered dots. The currently-selected detent is
 * anchored under the finger — the hand is already on the value it chose, so
 * every reachable value is a relative move — then the whole track clamps to
 * the viewport with EDGE_MARGIN_PX to spare.
 */
export function computeTrackGeometry(
  pointerX: number,
  anchorRect: { top: number; height: number },
  detentCount: number,
  selectedIndex: number,
  viewportWidth: number,
): TrackGeometry {
  const span = (detentCount - 1) * DETENT_SPACING_PX;
  const width = span + TRACK_PAD_PX * 2;
  const ideal = pointerX - selectedIndex * DETENT_SPACING_PX - TRACK_PAD_PX;
  const left = Math.max(
    EDGE_MARGIN_PX,
    Math.min(ideal, viewportWidth - EDGE_MARGIN_PX - width),
  );
  const top = anchorRect.top + anchorRect.height / 2 - TRACK_HEIGHT_PX / 2;
  const first = left + TRACK_PAD_PX;
  return {
    left,
    top,
    width,
    height: TRACK_HEIGHT_PX,
    detentCenters: Array.from(
      { length: detentCount },
      (_, i) => first + i * DETENT_SPACING_PX,
    ),
  };
}

/** Nearest detent to a pointer x, clamped to the track's ends. */
export function detentIndexForX(x: number, geometry: TrackGeometry): number {
  const first = geometry.detentCenters[0]!;
  const raw = Math.round((x - first) / DETENT_SPACING_PX);
  return Math.max(0, Math.min(geometry.detentCenters.length - 1, raw));
}

interface Press {
  pointerId: number;
  x: number;
  y: number;
  el: HTMLElement;
}

export function useHoldDrag({
  detentCount,
  selectedIndex,
  enabled,
  onCommit,
}: {
  detentCount: number;
  /** The committed detent at gesture start — anchored under the finger. */
  selectedIndex: number;
  /** False = fully inert: no timer, no axis claim, taps untouched. */
  enabled: boolean;
  /** Called once on release with the landed detent. Must be stable. */
  onCommit: (index: number) => void;
}) {
  const [active, setActive] = useState<{
    dragIndex: number;
    geometry: TrackGeometry;
  } | null>(null);

  const press = useRef<Press | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Mirror of `active` for window listeners and move handlers. */
  const activeRef = useRef<typeof active>(null);
  /** Escape/cancel happened while the finger was still down: the eventual
   *  pointer-up must neither commit nor let its trailing click through. */
  const cancelled = useRef(false);
  /** Swallows the click the browser fires after a hold's pointer-up. */
  const suppressClick = useRef(false);
  /** Finger-to-selected-detent x offset at activation. The geometry clamps
   *  to the viewport, so on a narrow screen the selected detent may NOT sit
   *  under the finger — the drag must stay RELATIVE to where the hand
   *  already is, or the first move teleports the value to whatever detent
   *  the clamp happened to leave underneath. */
  const dragOffset = useRef(0);
  /** Props can change mid-gesture (they don't in practice, but a stale
   *  closure in a window listener is not worth the bet). */
  const latest = useRef({ detentCount, selectedIndex, onCommit });
  latest.current = { detentCount, selectedIndex, onCommit };

  const setActiveBoth = useCallback(
    (next: { dragIndex: number; geometry: TrackGeometry } | null) => {
      activeRef.current = next;
      setActive(next);
    },
    [],
  );

  /** Window-scoped, added only for the active phase of a gesture. */
  const onWindowTouchMove = useCallback((e: TouchEvent) => {
    if (activeRef.current) e.preventDefault();
  }, []);

  /** Escape and teardown reference each other; the ref breaks the cycle
   *  while keeping both listener identities stable for add/remove pairing. */
  const teardownRef = useRef<() => void>(() => {});

  const onWindowKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key !== "Escape" || !activeRef.current) return;
    // Revert: the finger may stay down for seconds yet, so the trailing
    // click is suppressed at the eventual pointer-up, not on a timer here.
    cancelled.current = true;
    teardownRef.current();
  }, []);

  const teardown = useCallback(() => {
    clearTimeout(timer.current);
    const p = press.current;
    if (p) {
      try {
        p.el.releasePointerCapture(p.pointerId);
      } catch {
        /* never captured, or the pointer is already gone — both fine */
      }
    }
    window.removeEventListener("touchmove", onWindowTouchMove);
    window.removeEventListener("keydown", onWindowKeyDown);
    setActiveBoth(null);
  }, [onWindowTouchMove, onWindowKeyDown, setActiveBoth]);
  teardownRef.current = teardown;

  const activate = useCallback(() => {
    const p = press.current;
    if (!p) return;
    const { detentCount: count, selectedIndex: selected } = latest.current;
    const geometry = computeTrackGeometry(
      p.x,
      p.el.getBoundingClientRect(),
      count,
      selected,
      window.innerWidth,
    );
    // Touch/pen are implicitly captured to the pointer-down target already;
    // this is for a mouse outrunning the wrapper. try/catch for jsdom.
    try {
      p.el.setPointerCapture(p.pointerId);
    } catch {
      /* jsdom, or a pointer that ended during the hold */
    }
    // The active-phase axis claim — see the header. Non-passive on purpose.
    window.addEventListener("touchmove", onWindowTouchMove, { passive: false });
    window.addEventListener("keydown", onWindowKeyDown);
    dragOffset.current = p.x - geometry.detentCenters[selected]!;
    tap(8);
    setActiveBoth({ dragIndex: selected, geometry });
  }, [onWindowKeyDown, onWindowTouchMove, setActiveBoth]);

  // A gesture interrupted by unmount must not leave window listeners behind.
  useEffect(() => teardown, [teardown]);

  function onPointerDown(e: React.PointerEvent) {
    if (!enabled || press.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    cancelled.current = false;
    press.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      el: e.currentTarget as HTMLElement,
    };
    clearTimeout(timer.current);
    timer.current = setTimeout(activate, HOLD_MS);
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    const current = activeRef.current;
    if (!current) {
      // Pre-hold: any real movement means scroll intent — stand down and
      // let the user agent have the gesture (tap stays possible under slop).
      if (
        Math.abs(e.clientX - p.x) > SLOP_PX ||
        Math.abs(e.clientY - p.y) > SLOP_PX
      ) {
        clearTimeout(timer.current);
        press.current = null;
      }
      return;
    }
    // Dragging: x-only (vertical drift is ignored, like the reference), and
    // state moves only when the DETENT changes — a handful of renders per
    // gesture, never one per pixel. The offset keeps the mapping relative
    // to the finger even where the clamp displaced the track.
    const next = detentIndexForX(e.clientX - dragOffset.current, current.geometry);
    if (next !== current.dragIndex) {
      tap(5);
      setActiveBoth({ ...current, dragIndex: next });
    }
  }

  function settle() {
    // The browser click that follows pointer-up lands in the same task;
    // clear after it so ordinary taps keep working (use-swipe-actions).
    suppressClick.current = true;
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  }

  function onPointerUp(e: React.PointerEvent) {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    press.current = null;
    clearTimeout(timer.current);
    const current = activeRef.current;
    if (current) {
      latest.current.onCommit(current.dragIndex);
      teardown();
      settle();
    } else if (cancelled.current) {
      // Escape'd mid-hold; the lift still fires a click — swallow it.
      cancelled.current = false;
      settle();
    }
    // else: a plain tap — the click proceeds and opens the sheet.
  }

  function onPointerCancel(e: React.PointerEvent) {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    press.current = null;
    const wasActive = activeRef.current !== null;
    teardown();
    if (wasActive) settle();
  }

  function onClickCapture(e: React.MouseEvent) {
    if (suppressClick.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function onContextMenu(e: React.MouseEvent) {
    // Only while a gesture is live: Android's ~500ms context menu must not
    // interrupt a drag, but desktop right-click at rest stays native.
    if (press.current || activeRef.current) e.preventDefault();
  }

  return {
    active,
    props: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClickCapture,
      onContextMenu,
      // The pre-hold axis claim; omitted entirely when inert so a disabled
      // wrapper makes no claim at all (the swipe-actions rule).
      style: enabled
        ? ({
            touchAction: "pan-y pinch-zoom",
            WebkitTouchCallout: "none",
          } as React.CSSProperties)
        : undefined,
    },
  };
}

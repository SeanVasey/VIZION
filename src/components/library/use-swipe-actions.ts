"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Horizontal travel before the gesture is a swipe rather than a scroll. */
const INTENT_PX = 10;
/** Travel past which releasing snaps the row open instead of closed. */
const OPEN_PX = 56;
/** How far the row slides when open — the width of one action. */
export const SWIPE_REVEAL_PX = 84;

export type SwipeSide = "left" | "right" | null;

/**
 * iOS-style swipe-to-reveal for a list row, without a gesture library.
 *
 * Deliberately conservative about claiming the gesture: nothing moves until
 * the pointer has travelled INTENT_PX horizontally AND more horizontally than
 * vertically, so a vertical flick still scrolls the list normally. The row
 * only ever slides — the actions themselves are real buttons underneath, so
 * they stay reachable by keyboard and screen reader through the ⋯ menu, which
 * remains the discoverable path. Swipe is an accelerator, not the only way.
 */
export function useSwipeActions({ enabled = true }: { enabled?: boolean } = {}) {
  const [open, setOpen] = useState<SwipeSide>(null);
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const engaged = useRef(false);
  /** Set while a swipe is settling, so the row's link ignores the click that
   *  a pointer-up otherwise fires. */
  const suppressClick = useRef(false);

  const close = useCallback(() => {
    setOpen(null);
    setDx(0);
  }, []);

  // Any scroll dismisses an open row — matching the platform, and stopping a
  // stale open row from lingering off-screen.
  useEffect(() => {
    if (open === null) return;
    const onScroll = () => close();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [open, close]);

  function onPointerDown(e: React.PointerEvent) {
    if (!enabled || e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY };
    engaged.current = false;
  }

  function onPointerMove(e: React.PointerEvent) {
    const s = start.current;
    if (!s) return;
    const deltaX = e.clientX - s.x;
    const deltaY = e.clientY - s.y;
    if (!engaged.current) {
      // Vertical intent — hand the gesture back to the scroller for good.
      if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > INTENT_PX) {
        start.current = null;
        return;
      }
      if (Math.abs(deltaX) < INTENT_PX) return;
      engaged.current = true;
    }
    // Clamp so a row can't be dragged clear off its own track.
    const base = open === "left" ? SWIPE_REVEAL_PX : open === "right" ? -SWIPE_REVEAL_PX : 0;
    setDx(Math.max(-SWIPE_REVEAL_PX, Math.min(SWIPE_REVEAL_PX, base + deltaX)));
  }

  function onPointerUp() {
    if (!start.current) return;
    start.current = null;
    if (!engaged.current) return;
    engaged.current = false;
    suppressClick.current = true;
    // The click that follows pointerup lands in the same task; clear the flag
    // after it so ordinary taps keep working.
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    setDx((current) => {
      if (current <= -OPEN_PX) {
        setOpen("right");
        return -SWIPE_REVEAL_PX;
      }
      if (current >= OPEN_PX) {
        setOpen("left");
        return SWIPE_REVEAL_PX;
      }
      setOpen(null);
      return 0;
    });
  }

  /** Guard for the row's link: swallows the click that ends a swipe. */
  function onClickCapture(e: React.MouseEvent) {
    if (suppressClick.current || open !== null) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  return {
    open,
    close,
    /** Current horizontal offset in px. */
    offset: dx,
    /**
     * Spread onto the draggable element — the transform AND the gesture claim,
     * together, because they are one contract.
     *
     * `touch-action: pan-y` is load-bearing, not decoration. The row's content
     * is a `<Link>`, and the base layer gives every `a`/`button`
     * `touch-action: manipulation` (which permits panning on BOTH axes), so
     * without this the user agent stays free to claim a horizontal drag for
     * itself — scrolling, or Safari's back-navigation gesture — and hand us a
     * `pointercancel` instead of the movement. Mapping cancel to pointer-up
     * settles the swipe gracefully but cannot prevent the hijack. Declaring
     * `pan-y` here narrows the intersection of this element and its
     * descendants to "vertical is yours, horizontal is mine": the list still
     * scrolls natively, and the swipe reliably reaches this hook.
     *
     * Omitted when disabled — a row that cannot swipe has no claim to make.
     */
    style: {
      transform: `translateX(${dx}px)`,
      // `pan-y pinch-zoom`, not bare `pan-y`: the claim this row needs is over
      // the HORIZONTAL axis only. Omitting pinch-zoom would disable zoom
      // across the whole library list — the same WCAG defect the composer
      // chassis had — for no gesture benefit at all.
      touchAction: enabled ? ("pan-y pinch-zoom" as const) : undefined,
    },
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
    onClickCapture,
  };
}

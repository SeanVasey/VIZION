"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Modal overlay primitive — the app's one dialog surface, in two anchors:
 *
 *  - `anchor="bottom"` (default): the classic bottom sheet (library filters,
 *    compare drawer, attachment details, privacy notice, confirmations).
 *  - `anchor="side"`: a card vertically centered against the right edge of
 *    the app column. Built for the Target/Thinking pickers, whose triggers
 *    sit mid-screen in the composer rail — a bottom sheet opened a full
 *    viewport away from the pill the user just pressed, so the choice UI
 *    read as disconnected from the control it serves.
 *
 * The grab handle is a working control, not an ornament: it carries pointer
 * handlers, and dragging past a distance (or flicking) dismisses. Its
 * orientation states the gesture — horizontal pill on top for a sheet you
 * drag DOWN, vertical pill on the leading edge for a card you drag OUT to
 * the side. Drag stays scoped to the handle strip so it can never fight the
 * content's own vertical scroll.
 *
 * Closing plays a short exit (reverse of the entry) before unmounting. The
 * dialog leaves the accessibility tree the moment `open` flips — the exiting
 * node is aria-hidden and pointer-inert, focus is restored and the scroll
 * lock released immediately — so to assistive tech and tests the close is
 * instant; only the paint lingers ~200ms. A drag-dismiss carries its own
 * momentum instead: the inline transition finishes the throw, and the
 * keyframe exit is skipped so the panel doesn't snap back to rest first.
 *
 * Portaled to <body>: .glass-chrome/.glass-nav are containing blocks for
 * position:fixed descendants (their layer promotion — see globals.css), so an
 * overlay rendered inside either bar would anchor to the bar, not the
 * viewport. The scrim wrapper is the fixed element; the panel itself is
 * in-flow within it (the AvatarCropper shape), which also keeps the panel's
 * backdrop-filter off a fixed box on iOS.
 */

/** Movement (px) before a press commits to being a drag — under this it is a
 *  tap, and taps inside the grab strip (the close X) must stay taps. */
const DRAG_SLOP_PX = 8;
/** Flick dismiss: fast release counts even short of the distance threshold,
 *  but never under this travel — jsdom and real devices alike can report
 *  huge instantaneous velocities over tiny distances. */
const FLICK_MIN_TRAVEL_PX = 48;
const FLICK_VELOCITY_PX_MS = 0.5;
/** Unmount backstop if animationend/transitionend never arrives. */
const EXIT_FALLBACK_MS = 320;

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  /** True once travel beat DRAG_SLOP_PX and the pointer was captured. */
  active: boolean;
  offset: number;
  lastOffset: number;
  lastTime: number;
  velocity: number;
};

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  initialFocusRef,
  anchor = "bottom",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** "bottom" (default) rises from the bottom edge; "side" is a card
   *  vertically centered on the right edge of the app column, for pickers
   *  whose triggers live mid-screen. */
  anchor?: "bottom" | "side";
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // SSR guard: document doesn't exist during server render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Exit choreography. `exiting` keeps the node mounted while the out
  // animation plays; `cycle` keys the overlay so a reopen mid-exit remounts
  // fresh (clean inline styles from any drag, entry animation replays).
  // Adjusted during render — an effect would let one commit paint with the
  // sheet unmounted before the exit state landed.
  const [exiting, setExiting] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [prevOpen, setPrevOpen] = useState(open);
  const dragDismissedRef = useRef(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setCycle((c) => c + 1);
      setExiting(false);
      dragDismissedRef.current = false;
    } else {
      setExiting(true);
    }
  }

  // Focus in on open, restore on close; lock body scroll while open. Keyed on
  // `open`, not on unmount: the cleanup must run the moment the sheet begins
  // closing, so focus and scroll come back while the exit is still painting.
  //
  // Gated on `mounted` as well as `open`, and both are deps: the first render
  // returns null (the SSR guard below), so on that pass `panelRef` is still
  // null and there is nothing to focus. Without `mounted` the effect never ran
  // again, and a Sheet that is open from its very first render — rather than
  // toggled from closed — silently kept focus outside itself.
  useEffect(() => {
    if (!open || !mounted) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (initialFocusRef?.current ?? panelRef.current)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus();
    };
  }, [open, mounted, initialFocusRef]);

  // Unmount once the exit finishes — animationend for the keyframe exits,
  // transitionend for a drag-dismiss throw, timeout as the backstop. Under
  // the global reduced-motion collapse both fire near-instantly, so reduced
  // motion gets an effectively immediate close.
  useEffect(() => {
    if (!exiting) return;
    const panel = panelRef.current;
    const finish = () => {
      dragDismissedRef.current = false;
      setExiting(false);
    };
    const onDone = (e: Event) => {
      if (e.target === panel) finish();
    };
    panel?.addEventListener("animationend", onDone);
    panel?.addEventListener("transitionend", onDone);
    const t = window.setTimeout(finish, EXIT_FALLBACK_MS);
    return () => {
      panel?.removeEventListener("animationend", onDone);
      panel?.removeEventListener("transitionend", onDone);
      window.clearTimeout(t);
    };
  }, [exiting]);

  // ----- drag-to-close ------------------------------------------------------
  // Held in refs and written straight to style: a pointermove per frame must
  // not re-render the tree. The pointer is captured only after slop, so a
  // plain tap on anything in the grab strip (the X) still clicks normally.
  const dragRef = useRef<DragState | null>(null);
  const lastDragEndRef = useRef(-Infinity);
  const axis = anchor === "side" ? "x" : "y";

  function onGripPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (exiting) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      offset: 0,
      lastOffset: 0,
      lastTime: e.timeStamp,
      velocity: 0,
    };
    // Touch/pen are implicitly captured to the pointerdown target; a MOUSE
    // drag can outrun the strip before slop commits it, so capture up front —
    // but never for a press that starts on a control (the X): capture
    // retargets the eventual click to the strip, which would eat the tap.
    if (!(e.target as Element | null)?.closest?.("button, a, input, select, textarea")) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // jsdom lacks real pointer registration; capture is an enhancement.
      }
    }
  }

  function onGripPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag || !panel || exiting || e.pointerId !== drag.pointerId) return;
    const raw = axis === "x" ? e.clientX - drag.startX : e.clientY - drag.startY;
    if (!drag.active) {
      if (Math.abs(raw) < DRAG_SLOP_PX) return;
      drag.active = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // jsdom lacks real pointer registration; capture is an enhancement.
      }
    }
    // Follow toward the close edge 1:1; rubber-band the wrong way.
    const offset = raw >= 0 ? raw : Math.max(raw / 4, -24);
    const dt = Math.max(1, e.timeStamp - drag.lastTime);
    drag.velocity = (offset - drag.lastOffset) / dt;
    drag.lastOffset = offset;
    drag.lastTime = e.timeStamp;
    drag.offset = offset;
    panel.style.transition = "none";
    panel.style.transform =
      axis === "x" ? `translateX(${offset}px)` : `translateY(${offset}px)`;
  }

  function onGripPointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const panel = panelRef.current;
    dragRef.current = null;
    if (!drag || !panel || !drag.active || e.pointerId !== drag.pointerId) return;
    lastDragEndRef.current = e.timeStamp;
    const size = axis === "x" ? panel.offsetWidth : panel.offsetHeight;
    // Distance wins outright; a flick wins early but only past real travel.
    const threshold = Math.min(112, Math.max(56, size * 0.3));
    const shouldClose =
      !exiting &&
      e.type !== "pointercancel" &&
      (drag.offset > threshold ||
        (drag.offset > FLICK_MIN_TRAVEL_PX && drag.velocity > FLICK_VELOCITY_PX_MS));
    if (shouldClose) {
      // Finish the throw from the current offset — inline transition instead
      // of the keyframe exit, which would snap to rest before fading.
      dragDismissedRef.current = true;
      panel.style.transition = "transform 200ms ease-in, opacity 200ms ease-in";
      panel.style.transform =
        axis === "x" ? `translateX(${size + 48}px)` : `translateY(${size + 48}px)`;
      panel.style.opacity = "0";
      onClose();
    } else {
      panel.style.transition = "transform 200ms cubic-bezier(0.2, 0, 0, 1)";
      panel.style.transform = "";
    }
  }

  const gripProps = {
    onPointerDown: onGripPointerDown,
    onPointerMove: onGripPointerMove,
    onPointerUp: onGripPointerEnd,
    onPointerCancel: onGripPointerEnd,
    "data-sheet-grip": axis,
  } as const;
  // --------------------------------------------------------------------------

  if (!mounted || (!open && !exiting)) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    // Cycle focus within the panel (dialog focus trap).
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    // The panel is a leading boundary as well as `first`. With no
    // `initialFocusRef` the effect above focuses the panel itself, and the
    // panel is `tabIndex={-1}` so it never appears in `focusables` — a
    // Shift+Tab straight after open therefore escaped backwards past a scrim
    // that `aria-modal` had just declared impassable.
    const atStart = document.activeElement === first || document.activeElement === panel;
    if (e.shiftKey && atStart) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /** Scrim/column click closes only on itself — panel clicks bubble with a
   *  different target. */
  function onSurfaceClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  /** A release that WAS a drag can still mint a click (retargeted to the
   *  capture element); swallow exactly the first click right after one so a
   *  settled spring-back never registers as a press. */
  function onClickCapture(e: React.MouseEvent) {
    if (e.timeStamp - lastDragEndRef.current < 400) {
      lastDragEndRef.current = -Infinity;
      e.preventDefault();
      e.stopPropagation();
    }
  }

  const isSide = anchor === "side";
  const panelAnim = exiting
    ? dragDismissedRef.current
      ? ""
      : isSide
        ? "sheet-out-side"
        : "sheet-out"
    : isSide
      ? "sheet-in-side"
      : "sheet-in";

  const closeButton = (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      className="-my-1 -mr-2 flex h-11 w-11 items-center justify-center rounded-full text-silver transition-colors hover:text-chalk"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
        <path
          d="M6 6l12 12M18 6L6 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );

  const panel = isSide ? (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      // rounded-[20px]: the chrome radius — .glass-nav/.glass-chrome corner
      // both bars at 20px (globals.css), and this card floats as peer
      // chrome, so a Tailwind step (16px/24px) reads subtly off beside them.
      className={`glass ${panelAnim} flex max-h-[min(70dvh,34rem)] w-[min(20rem,calc(100vw-4rem))] rounded-[20px] focus-visible:shadow-none`}
    >
      {/* Leading-edge grab rail: the vertical pill says "this card slides
          sideways", and the whole strip is the drag target. */}
      <div
        {...gripProps}
        aria-hidden="true"
        className="flex w-7 shrink-0 cursor-grab touch-none select-none items-center justify-center"
      >
        <div className="h-10 w-1 rounded-full bg-hair" />
      </div>
      <div className="flex min-w-0 grow flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 pr-4 pt-3">
          <h2
            id={titleId}
            className="font-body text-sm font-semibold uppercase tracking-wider text-chalk"
          >
            {title}
          </h2>
          {closeButton}
        </div>
        <div className="min-h-0 grow overflow-y-auto overscroll-contain pb-4 pr-4 pt-2">
          {children}
        </div>
        {footer && (
          <div className="shrink-0 border-t border-hair py-3 pr-4">{footer}</div>
        )}
      </div>
    </div>
  ) : (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={`glass ${panelAnim} mx-auto flex max-h-[85dvh] w-full max-w-screen-sm flex-col rounded-t-2xl focus-visible:shadow-none`}
    >
      {/* The whole header strip drags, not just the pill — the pill is the
          hint, the strip is the target. Slop-gated capture keeps the X a
          plain tap. */}
      <div
        {...gripProps}
        className="shrink-0 cursor-grab touch-none select-none px-4 pt-3"
      >
        <div aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-hair" />
        <div className="mt-2 flex items-center justify-between gap-2">
          <h2
            id={titleId}
            className="font-body text-sm font-semibold uppercase tracking-wider text-chalk"
          >
            {title}
          </h2>
          {closeButton}
        </div>
      </div>
      <div className="min-h-0 grow overflow-y-auto overscroll-contain px-4 pb-4 pt-2">
        {children}
      </div>
      {footer && (
        <div className="shrink-0 border-t border-hair px-4 py-3 pb-safe">{footer}</div>
      )}
      {/* Safe-area padding when there's no footer strip to carry it. */}
      {!footer && <div className="pb-safe" />}
    </div>
  );

  return createPortal(
    <div
      key={cycle}
      aria-hidden={exiting || undefined}
      className={`${exiting ? "scrim-out pointer-events-none" : "scrim-in"} fixed inset-0 z-[70] ${
        isSide ? "" : "flex flex-col justify-end"
      }`}
      onKeyDown={onKeyDown}
      onClick={onSurfaceClick}
      onClickCapture={onClickCapture}
      style={{
        // Slash-opacity can't apply to var() tokens — mix explicitly (theme-swapped).
        backgroundColor: "color-mix(in srgb, var(--void) 80%, transparent)",
      }}
    >
      {isSide ? (
        // The centering column: same width discipline as the app shell, so on
        // any viewport the card lands beside the composer rail, not at a far
        // desktop edge. Clicks on the column (outside the panel) are scrim
        // clicks in spirit and close the same way.
        <div
          className="mx-auto flex h-full w-full max-w-screen-sm items-center justify-end pl-3 pr-[max(0.75rem,env(safe-area-inset-right))]"
          onClick={onSurfaceClick}
        >
          {panel}
        </div>
      ) : (
        panel
      )}
    </div>,
    document.body,
  );
}

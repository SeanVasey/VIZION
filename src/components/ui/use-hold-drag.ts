"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { tap } from "@/lib/haptics";

/**
 * Press-and-hold → drag-between-detents, in one continuous gesture
 * (docs/decisions/0012-hold-slider.md).
 *
 * This is the accelerator half of a two-path control: a plain TAP falls
 * through to the wrapped trigger's own click (the sheet — the complete,
 * discoverable path), while holding past HOLD_MS — or sliding sideways past
 * slop in the same unbroken press, which is how the reference control is
 * actually used — expands an overlay track and the same pointer drags
 * between detents; release commits. The overlay is pointer-transparent
 * decoration — this hook owns the whole gesture from the wrapper element,
 * and owns ONLY gestures that begin in the wrapper's own DOM subtree: the
 * pickers' Sheets are body portals whose events still bubble up the React
 * tree, and they are refused at pointer-down, so an open sheet is inert
 * to the slider.
 *
 * The gesture is claimed in two phases, extending the axis-claim rule
 * (tasks/lessons.md, 2026-07): at rest the wrapper claims every
 * single-finger pan (`touch-action: pinch-zoom` — zoom stays native, and
 * never the `none` that once disabled it app-wide). touch-action is
 * consulted once, at gesture start, so this resting value is the pre-hold
 * window's ONLY defense: the original `pan-y` grant let the UA read a
 * pre-hold vertical drift as a scroll and end the press with
 * `pointercancel` — measured in Chromium under synthesized touch (one
 * pointermove, then pointercancel ~6ms later), and the on-device
 * "the slider never appears" (2026-08-09, ADR-0012 amendment). Once the
 * hold fires the pointer is captured AND a non-passive window `touchmove`
 * preventDefault stops a late vertical pan from stealing the pointer
 * mid-drag. The two composer pills are not a scroll surface — unlike the
 * library's swipe rows, which rightly keep `pan-y` because a full-width
 * list row IS one.
 */

/** Hold time before the slider engages. Above usePressable's 130ms press
 *  floor (a decisive tap must stay a tap), below the ~500ms system
 *  long-press so the iOS callout never races the overlay. */
export const HOLD_MS = 300;
/** Pre-hold movement past this is INTENT, not jitter — and the axis says
 *  which intent: x-dominant engages the track at once (press-and-slide, the
 *  reference gesture), y-dominant stands down for the scroll. Matches
 *  use-swipe-actions' INTENT_PX. */
export const SLOP_PX = 10;
/** Horizontal travel per detent — one 44px touch target each. */
export const DETENT_SPACING_PX = 44;
/** Mode boundary for compression: while compressed spacing stays at or
 *  above this, the whole capsule (pads and edge margins included) fits the
 *  visible region; below it, the geometry stops reserving the capsule's
 *  chrome and constrains only the detent SPAN — see computeTrackGeometry.
 *  Ergonomics hold either way because zoom multiplies PHYSICAL travel. */
export const MIN_DETENT_SPACING_PX = 12;
/** Span-mode inset: the extreme detent centers keep this much clearance
 *  from the visible region's edges, so the first and last stops are never
 *  razor-edge pointer targets. */
export const CENTER_INSET_PX = 8;
/** Inset from the capsule's rounded end to the first/last detent center. */
export const TRACK_PAD_PX = 22;
/** Rendered height of the overlay capsule. */
const TRACK_HEIGHT_PX = 48;
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
 * geometry must derive from these constants and the few numbers passed in,
 * never from measuring rendered dots. The track has a FIXED HOME — centered
 * in the viewport the user is LOOKING AT, on the gesturing rail's row —
 * the same spot for every press (ADR-0012 amendment 4, from the owner's
 * reference recording: a capsule that lands wherever the finger happened to
 * be reads as floaty, and the first cut's anchor-under-finger placement did
 * exactly that). The finger still maps RELATIVELY through dragOffset, so
 * the press point never jumps the selection; only the capsule's home is
 * fixed.
 *
 * `viewport` is the VISUAL viewport in layout-viewport coordinates —
 * {left: 0, width: innerWidth} unzoomed, `visualViewport`'s offset/width
 * under pinch zoom. This control deliberately preserves native pinch zoom
 * (the resting `pinch-zoom` claim), and a fixed-position capsule centered
 * on the LAYOUT viewport can open entirely outside a zoomed-in user's view
 * (Codex review, PR #103). Unzoomed, the shell is a centered
 * max-w-screen-sm column, so the visual center IS the composer's.
 *
 * The home is the visible region's CENTER in every mode — placement never
 * depends on the selection, so the same rail always expands in the same
 * spot. What adapts is the spacing (Codex review, third and fourth
 * passes: a placement frozen around the selected detent kept the SPAWN
 * visible but let the drag walk the thumb out of the region, and any
 * placement that hides a center makes that value unreachable, because the
 * pointer cannot travel past the region's edge):
 *
 * - FULL: the 44px ladder plus capsule chrome fits inside the margins —
 *   spacing stays DETENT_SPACING_PX.
 * - COMPRESSED: spacing shrinks toward MIN_DETENT_SPACING_PX so capsule,
 *   pads, and margins all still fit.
 * - SPAN-ONLY: below that, the geometry stops reserving the capsule's
 *   chrome — the rounded ends and margins may overflow the region (the
 *   overlay is pointer-transparent decoration) while the detent CENTERS
 *   compress into the region minus CENTER_INSET_PX. Every stop stays
 *   visible; zoom multiplies physical travel, so the tighter detents
 *   cost no precision.
 *
 * Single-GESTURE reach is bounded by where the press began — a finger
 * cannot travel past the screen's edge, at any zoom, under any geometry
 * (the original anchor-under-finger placement had the same physics for
 * the top tiers on an unzoomed phone, and so does the reference
 * control). That bound is answered by COMPOSITION, not by gain: release
 * re-anchors, so the next hold starts from the new selection with fresh
 * travel room — any value is at most two centered gestures away — and
 * the sheet remains the complete single-tap path (WCAG 2.5.7). Drag gain
 * is deliberately constant and side-symmetric: the finger owns the
 * thumb 1:1, in both directions, always.
 */
export function computeTrackGeometry(
  anchorRect: { top: number; height: number },
  detentCount: number,
  viewport: { left: number; width: number },
): TrackGeometry {
  const steps = Math.max(detentCount - 1, 1);
  const chromeSpacing = (viewport.width - EDGE_MARGIN_PX * 2 - TRACK_PAD_PX * 2) / steps;
  const spacing =
    chromeSpacing >= MIN_DETENT_SPACING_PX
      ? Math.min(DETENT_SPACING_PX, chromeSpacing)
      : Math.max(
          1,
          Math.min(DETENT_SPACING_PX, (viewport.width - CENTER_INSET_PX * 2) / steps),
        );
  const width = steps * spacing + TRACK_PAD_PX * 2;
  // Both modes center the SPAN on the region's center; centering the span
  // and centering the capsule are the same thing (symmetric pads).
  const first = viewport.left + (viewport.width - steps * spacing) / 2;
  const left = first - TRACK_PAD_PX;
  const top = anchorRect.top + anchorRect.height / 2 - TRACK_HEIGHT_PX / 2;
  return {
    left,
    top,
    width,
    height: TRACK_HEIGHT_PX,
    detentCenters: Array.from({ length: detentCount }, (_, i) => first + i * spacing),
  };
}

/** Nearest detent to a pointer x, clamped to the track's ends. Spacing is
 *  read from the geometry itself — under pinch-zoom compression it is
 *  narrower than DETENT_SPACING_PX. */
export function detentIndexForX(x: number, geometry: TrackGeometry): number {
  const centers = geometry.detentCenters;
  const first = centers[0]!;
  const spacing = centers.length > 1 ? centers[1]! - first : DETENT_SPACING_PX;
  const raw = Math.round((x - first) / spacing);
  return Math.max(0, Math.min(centers.length - 1, raw));
}

interface Press {
  pointerId: number;
  x: number;
  y: number;
  el: HTMLElement;
}

/**
 * ONE live press/gesture across every hold-slider (module scope). The two
 * composer rails sit adjacent and both can be enabled, so two fingers could
 * otherwise run two gestures at once — stacked full-viewport focus pairs,
 * crossed capsules, and a shared `data-hold-gesture` attribute whose first
 * teardown thawed the world under the survivor's blur (Codex review,
 * seventh pass). Exclusive ownership is also the reference platform's own
 * semantic. Claimed at pointer-down, released wherever the press record
 * dies (up, cancel, unmount).
 *
 * A refused press is refused WHOLE: its admission is denied here and its
 * synthesized click is consumed at onClickCapture for as long as the claim
 * is held. The seventh pass first let that click fall through as a plain
 * tap, and the ninth corrected it — on hybrid-input devices the "tap"
 * opened the other pill's sheet (z-70) under the live capsule (z-85),
 * recreating the sheet-mid-gesture state the admission guard exists to
 * make impossible. The consumption carries no self-exemption (tenth pass):
 * while any press is live, a click on the OWNING pill can only be a second
 * input device — a mouse inside a touch press's pre-hold window, Enter on
 * the focused pill mid-drag — never the plain tap, which by protocol order
 * arrives only after pointer-up has already released the claim. During the
 * ACTIVE phase the focus pair additionally shields the whole viewport
 * (HoldSlider's pointer-events), so non-wrapped triggers go inert too.
 */
let gestureOwner: object | null = null;

export function useHoldDrag({
  detentCount,
  selectedIndex,
  enabled,
  onCommit,
}: {
  detentCount: number;
  /** The committed detent at gesture start — the drag maps relative to it
   *  (dragOffset), wherever in the fixed-home track it sits. */
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
  /** The gesture died while the pointer was still down — Escape mid-drag,
   *  or pre-hold movement past slop: the eventual pointer-up must neither
   *  commit nor let its trailing click through. */
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

  /** This instance's identity for the module-level exclusive-gesture claim. */
  const ownerToken = useRef<object>({});

  /** A press this wrapper refused for a FOREIGN claim, whose click has not
   *  yet arrived. The claim alone cannot carry the refusal to its end: the
   *  owner can release before the refused pointer lifts, and at click time
   *  both the claim and suppressClick are clear — the press documented as
   *  refused whole then opened this pill's sheet (thirteenth pass).
   *  Per-instance, so it can never collide with another wrapper's
   *  legitimate clicks; reset by the next pointer-down on this wrapper
   *  (a new stream supersedes), cleared when the refused click is eaten.
   *  Deliberately NOT set for same-wrapper refusals (`press.current`): both
   *  streams share this one wrapper, and a boolean cannot tell the refused
   *  stream's click from the live press's own legitimate one. */
  const refusedPress = useRef(false);

  /** The refused stream's id and its end-watch. A refusal must not outlive
   *  its own stream (Vercel agent review, fourteenth round): a refused
   *  pointer that releases OUTSIDE this wrapper never sends the click the
   *  marker waits for, and the stale marker ate the pill's next keyboard or
   *  programmatic click — an activation a keyboard user must never lose.
   *  The window hears the stream end anywhere; the marker then clears on a
   *  zero-timeout, outliving exactly the one same-task click the lift can
   *  still deliver (the settle() ordering trick). */
  const refusedPointerId = useRef<number | null>(null);
  const refusedClear = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onRefusedEnd = useCallback((e: PointerEvent) => {
    if (e.pointerId !== refusedPointerId.current) return;
    refusedPointerId.current = null;
    window.removeEventListener("pointerup", onRefusedEnd);
    window.removeEventListener("pointercancel", onRefusedEnd);
    refusedClear.current = setTimeout(() => {
      refusedPress.current = false;
    }, 0);
  }, []);
  const disarmRefusedWatch = useCallback(() => {
    refusedPointerId.current = null;
    clearTimeout(refusedClear.current);
    window.removeEventListener("pointerup", onRefusedEnd);
    window.removeEventListener("pointercancel", onRefusedEnd);
  }, [onRefusedEnd]);

  /** Give up the exclusive claim — called wherever `press.current` dies. */
  const releaseGesture = useCallback(() => {
    if (gestureOwner === ownerToken.current) gestureOwner = null;
  }, []);

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

  /** Wheel is the pointer channel's scroll the shield cannot stop by
   *  hit-testing alone (the scrim is not scrollable, but the page under a
   *  wheel-scrolling cursor still is in some engines) and the touchmove
   *  block never sees: under a live capsule the document must not glide
   *  beneath the frozen world (modality audit). Non-passive, active phase
   *  only — the same shape as the touchmove claim above. */
  const onWindowWheel = useCallback((e: WheelEvent) => {
    if (activeRef.current) e.preventDefault();
  }, []);

  /** Escape and teardown reference each other; the ref breaks the cycle
   *  while keeping both listener identities stable for add/remove pairing. */
  const teardownRef = useRef<() => void>(() => {});

  const onWindowKey = useCallback((e: KeyboardEvent) => {
    if (!activeRef.current) return;
    if (e.type === "keydown" && e.key === "Escape") {
      // Revert: the finger may stay down for seconds yet, so the trailing
      // click is suppressed at the eventual pointer-up, not on a timer here.
      cancelled.current = true;
      teardownRef.current();
      return;
    }
    // The focus pair shields POINTERS; keys are their own input channel
    // (fourteenth pass, then widened in the modality audit): a background
    // control left keyboard-focused — or tabbed to mid-drag — activated on
    // Enter/Space and opened its sheet under the live capsule, and an
    // enumeration of "activation keys" was itself the next hole (arrows,
    // PageUp/Down, Home/End scroll the document beneath the frozen world;
    // Tab wanders focus). While the capsule is up, every unmodified key
    // except Escape dies here at the window's capture phase, keydown and
    // keyup both (native buttons activate Space on keyup) — and the
    // activation keys die REGARDLESS of modifiers, because Ctrl/Meta+Enter
    // still runs a focused button's native activation (fifteenth pass:
    // the modifier exemption was scoped for browser chords like copy and
    // reload, and page-level activation rode through it). Escape above
    // stays the one designed key.
    const isActivationKey = e.key === "Enter" || e.key === " ";
    if (
      e.key !== "Escape" &&
      (isActivationKey || (!e.ctrlKey && !e.metaKey && !e.altKey))
    ) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const teardown = useCallback(() => {
    clearTimeout(timer.current);
    // Pointer capture is deliberately NOT released here (eleventh pass).
    // Capture's lifetime is the PRESS's, not the overlay's: on the Escape
    // path the press record outlives this teardown until the finger lifts,
    // and the captured stream is the only thing that routes a lift landing
    // far from the pill (mid-drag the pointer usually is) back to
    // onPointerUp — which is where the press dies, the app-wide claim
    // releases, and the trailing click is swallowed. Releasing early
    // orphaned that lift in real browsers: press and claim leaked, and
    // every wrapped pill went dead until remount (jsdom hid it — it has no
    // capture routing, so the unit lift always "landed" on the pill). No
    // explicit release is needed anywhere: pointerup and pointercancel
    // auto-release capture per spec, and unmount disconnects the element.
    window.removeEventListener("touchmove", onWindowTouchMove);
    window.removeEventListener("wheel", onWindowWheel);
    window.removeEventListener("keydown", onWindowKey, true);
    window.removeEventListener("keyup", onWindowKey, true);
    document.documentElement.removeAttribute("data-hold-gesture");
    setActiveBoth(null);
  }, [onWindowTouchMove, onWindowWheel, onWindowKey, setActiveBoth]);
  teardownRef.current = teardown;

  /** The pre-hold safety net for UNCAPTURED exits (twelfth pass). A mouse
   *  is not implicitly captured, so a press starting near the pill's edge
   *  can leave the wrapper inside the slop window — every later move and
   *  the lift itself then dispatch elsewhere, the wrapper hears nothing,
   *  and the hold timer fired on a stale press: a phantom overlay, freeze,
   *  and input shield with no pointer down, and the app-wide claim held
   *  until remount (the same lesson the y-dominant stand-down learned in
   *  2026-07, one window earlier). Window-scoped and armed only while a
   *  press is live; the wrapper's own handlers run first (target before
   *  window), so this acts only on lifts the wrapper never saw — and an
   *  outside lift synthesizes no click in the wrapper's subtree, so there
   *  is nothing to suppress. Chosen over capturing the mouse at admission,
   *  which would have changed edge-press semantics (a drag-away would
   *  engage or commit where today nothing happens). */
  const onWindowPointerEnd = useCallback(
    (e: PointerEvent) => {
      const p = press.current;
      if (!p || e.pointerId !== p.pointerId) return;
      press.current = null;
      releaseGesture();
      teardownRef.current();
      window.removeEventListener("pointerup", onWindowPointerEnd);
      window.removeEventListener("pointercancel", onWindowPointerEnd);
    },
    [releaseGesture],
  );

  /** The one ending no pointer or key event can report: the WINDOW leaves.
   *  An alt-tab, an OS app switch, or a locked phone mid-gesture delivers
   *  nothing at all to this document — the mouse button releases in some
   *  other window, the up never dispatches here, and press, claim, capsule,
   *  and the world-freeze would all sit leaked in a background tab (the
   *  modality audit; the same leak class as the Escape and edge-exit
   *  passes, through the only channel with no event to catch). Concealment
   *  is treated exactly like pointercancel: revert, never commit. */
  const onWindowConceal = useCallback(
    (e: Event) => {
      if (e.type === "visibilitychange" && document.visibilityState !== "hidden") {
        return;
      }
      if (!press.current) return;
      const concealed = press.current;
      press.current = null;
      releaseGesture();
      teardownRef.current();
      window.removeEventListener("pointerup", onWindowPointerEnd);
      window.removeEventListener("pointercancel", onWindowPointerEnd);
      window.removeEventListener("blur", onWindowConceal);
      document.removeEventListener("visibilitychange", onWindowConceal);
      // The concealed stream is not finished — only abandoned. Capture can
      // survive into the user's return, so the eventual lift over the pill
      // still synthesizes a click, minutes after the revert and far outside
      // settle()'s same-task window (fifteenth pass). The refused-stream
      // machinery is exactly this shape: mark the stream, watch for its
      // true end anywhere, clear one task later so only its own click dies.
      refusedPress.current = true;
      refusedPointerId.current = concealed.pointerId;
      window.addEventListener("pointerup", onRefusedEnd);
      window.addEventListener("pointercancel", onRefusedEnd);
    },
    [releaseGesture, onWindowPointerEnd, onRefusedEnd],
  );

  /** Disarm the nets wherever the press dies through the wrapper itself. */
  const disarmWindowNet = useCallback(() => {
    window.removeEventListener("pointerup", onWindowPointerEnd);
    window.removeEventListener("pointercancel", onWindowPointerEnd);
    window.removeEventListener("blur", onWindowConceal);
    document.removeEventListener("visibilitychange", onWindowConceal);
  }, [onWindowPointerEnd, onWindowConceal]);

  /** `currentX`: set when a pre-hold SLIDE engages the track — the finger
   *  has already travelled, so the first dragIndex maps its position now
   *  rather than snapping back to the anchor (a quick flick would otherwise
   *  expand, commit the unchanged selection, and read as a no-op). The
   *  timer path passes nothing: the finger is still on the anchor. */
  const activate = useCallback(
    (currentX?: number) => {
      const p = press.current;
      if (!p) return;
      // No capsule over an open sheet, enforced from the second direction
      // (thirteenth pass): the admission guard stops gestures BEGINNING over
      // a sheet, but during the pre-hold window the input shield is not yet
      // mounted, so a second input device can open one through a non-wrapped
      // trigger (the template button, a confirm) before the timer fires.
      // The sheet is the senior surface — activation stands down exactly
      // like a y-dominant scroll: cancelled, captured so the lift routes
      // back, click swallowed, the sheet untouched. role="dialog" is the
      // web-platform contract every sheet announces; probed once, at this
      // single moment, honoring the accessibility tree: an EXITING sheet
      // stays mounted for its animation under an aria-hidden wrapper, and
      // hidden means closed — it is inert and vanishing, so a hold begun
      // as it closes still engages. (This reverses the ninth pass's
      // recorded "accepted residual" — the probe is a platform semantic,
      // not the DOM coupling that decline priced in.)
      const dialogOpen = Array.from(document.querySelectorAll('[role="dialog"]')).some(
        (d) => !d.closest('[aria-hidden="true"]'),
      );
      if (dialogOpen) {
        cancelled.current = true;
        try {
          p.el.setPointerCapture(p.pointerId);
        } catch {
          /* jsdom, or a pointer already ended */
        }
        return;
      }
      const { detentCount: count, selectedIndex: selected } = latest.current;
      // The visual viewport, so a pinch-zoomed user gets the capsule inside
      // the region they are looking at; jsdom (and old engines) fall back to
      // the layout viewport, where the two are the same thing.
      const vv = window.visualViewport;
      const geometry = computeTrackGeometry(
        p.el.getBoundingClientRect(),
        count,
        vv
          ? { left: vv.offsetLeft, width: vv.width }
          : { left: 0, width: window.innerWidth },
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
      window.addEventListener("wheel", onWindowWheel, { passive: false });
      // Capture phase, both key events — see onWindowKey: keys must die
      // before any focused control's own handlers see them.
      window.addEventListener("keydown", onWindowKey, true);
      window.addEventListener("keyup", onWindowKey, true);
      // The world pauses under the gesture: this attribute freezes the
      // ambient field (AmbientNebula's canvas gate + the blooms'
      // animation-play-state), which is what makes the focus blur's
      // one-time-filter claim TRUE — a backdrop that keeps animating
      // beneath a backdrop-filter re-filters every frame (Codex review,
      // sixth pass; the bloom lesson's mechanism). Removed in teardown().
      document.documentElement.setAttribute("data-hold-gesture", "");
      dragOffset.current = p.x - geometry.detentCenters[selected]!;
      tap(8);
      setActiveBoth({
        dragIndex:
          currentX === undefined
            ? selected
            : detentIndexForX(currentX - dragOffset.current, geometry),
        geometry,
      });
    },
    [onWindowKey, onWindowTouchMove, onWindowWheel, setActiveBoth],
  );

  // A gesture interrupted by unmount must not leave window listeners — or
  // the exclusive claim — behind.
  useEffect(
    () => () => {
      teardown();
      disarmWindowNet();
      disarmRefusedWatch();
      releaseGesture();
    },
    [teardown, disarmWindowNet, disarmRefusedWatch, releaseGesture],
  );

  function onPointerDown(e: React.PointerEvent) {
    if (!enabled || press.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // A new stream on this wrapper supersedes any still-pending refusal.
    refusedPress.current = false;
    disarmRefusedWatch();
    // One gesture at a time, app-wide (see gestureOwner): while another
    // pill's press or drag is live, this press is refused outright — and
    // its eventual click dies in onClickCapture, marked here so the
    // refusal survives even if the owner releases first. The end-watch
    // bounds the marker to the refused stream's own lifetime.
    if (gestureOwner && gestureOwner !== ownerToken.current) {
      refusedPress.current = true;
      refusedPointerId.current = e.pointerId;
      window.addEventListener("pointerup", onRefusedEnd);
      window.addEventListener("pointercancel", onRefusedEnd);
      return;
    }
    // Admission rule: a gesture may only begin in the wrapper's own DOM
    // subtree. The wrapped children include each picker's SHEET — a body
    // portal that React still bubbles up the COMPONENT tree — so without
    // this, a press anywhere in the open sheet (a row, a segment, the
    // scrim) started a gesture here: after the hold, the capsule drew
    // itself across the open sheet, release committed, and the trailing-
    // click suppression ate the row's own tap (2026-08-10). Containment,
    // not identity — every legitimate press targets the pill, a
    // descendant. Every later path keys off `press.current`, so refusing
    // the press record here closes move/up/stand-down/suppress in one
    // place.
    if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return;
    gestureOwner = ownerToken.current;
    cancelled.current = false;
    press.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      el: e.currentTarget as HTMLElement,
    };
    // The uncaptured-exit net and the concealment revert both ride the
    // whole press — see their declarations.
    window.addEventListener("pointerup", onWindowPointerEnd);
    window.addEventListener("pointercancel", onWindowPointerEnd);
    window.addEventListener("blur", onWindowConceal);
    document.addEventListener("visibilitychange", onWindowConceal);
    clearTimeout(timer.current);
    timer.current = setTimeout(activate, HOLD_MS);
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    const current = activeRef.current;
    if (!current) {
      if (cancelled.current) return;
      const dx = Math.abs(e.clientX - p.x);
      const dy = Math.abs(e.clientY - p.y);
      // Under slop either way: still a tap-in-progress — keep waiting.
      if (dx <= SLOP_PX && dy <= SLOP_PX) return;
      // Pre-hold, past slop: the AXIS says what the movement meant.
      //
      // X-dominant is the gesture itself, not a departure from it: the
      // reference control engages under press-and-slide in one motion, and
      // the first shipped cut waited out the hold timer regardless — on a
      // real phone the first move outran the timer, the press was quietly
      // discarded, and the control read as dead ("the slider never
      // appears", 2026-08-09; measured in the app under synthesized
      // touch). The wrapper has always denied the UA this axis, so
      // engaging is the only honest reading of a sideways slide.
      if (dx >= dy) {
        clearTimeout(timer.current);
        activate(e.clientX);
        return;
      }
      // Y-dominant: scroll intent — stand down. The press is marked
      // cancelled rather than dropped: a mouse release over the pill still
      // fires a browser click no matter how far it travelled, and a press
      // this hook classified as not-a-tap must not fall through and open
      // the sheet (Codex review, PR #99 — the same rule use-swipe-actions
      // applies past the same threshold). Capture, so the lift lands here
      // even when a MOUSE wanders off the wrapper before releasing — an
      // uncaptured stand-down leaked `press` and left the wrapper inert
      // until remount. (Touch was never exposed: its implicit capture
      // already routes the lift through the wrapper.)
      clearTimeout(timer.current);
      cancelled.current = true;
      try {
        p.el.setPointerCapture(p.pointerId);
      } catch {
        /* jsdom, or a pointer already ended */
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
    releaseGesture();
    disarmWindowNet();
    clearTimeout(timer.current);
    const current = activeRef.current;
    if (current) {
      latest.current.onCommit(current.dragIndex);
      teardown();
      settle();
    } else if (cancelled.current) {
      // Escape'd or moved-past-slop while down; the lift still fires a
      // click — swallow it.
      cancelled.current = false;
      settle();
    }
    // else: a plain tap — the click proceeds and opens the sheet.
  }

  function onPointerCancel(e: React.PointerEvent) {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    press.current = null;
    releaseGesture();
    disarmWindowNet();
    const wasActive = activeRef.current !== null;
    teardown();
    if (wasActive) settle();
  }

  function onClickCapture(e: React.MouseEvent) {
    // Eat the click when this instance's own gesture just settled
    // (suppressClick), while ANY hold-slider press is live — foreign or
    // our own, deliberately without a self-exemption — or when it belongs
    // to a stream this wrapper refused whose owner has since released
    // (refusedPress; thirteenth pass). The ninth pass consumed only
    // foreign-claim clicks; the tenth closed the self-carve-out: with our
    // own claim live, a click on this pill can only be a SECOND input
    // device (a mouse click landing inside a touch press's pre-hold
    // window, Enter on the focused pill mid-drag), and it opened this
    // pill's own sheet under the arriving capsule. The legitimate plain-tap
    // click is safe by protocol order, not by identity: pointer-up releases
    // the claim synchronously before the browser dispatches the click, so
    // at click time gestureOwner is already null.
    //
    // The refusal marker gates only POINTER-DERIVED clicks (detail ≥ 1):
    // keyboard and programmatic activation carry detail 0 and always pass
    // it. This is the discriminator the marker's whole lifecycle turned out
    // to need (fourteenth, sixteenth, seventeenth passes): a marker whose
    // stream ended where no event reports it — released in another app —
    // can sit stranded, and every timing-based expiry had a hole (the
    // foreground-clear let a user who returned STILL HOLDING lift into an
    // un-suppressed click). detail needs no timing: a stranded marker can
    // never touch a keyboard user, a later pointer stream clears it at its
    // own pointer-down, and the one click it exists to eat — its own
    // stream's — is pointer-derived by definition.
    if (
      suppressClick.current ||
      (refusedPress.current && e.detail > 0) ||
      gestureOwner !== null
    ) {
      refusedPress.current = false;
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
      // The resting claim (see the header for why it must deny every
      // single-finger pan); omitted entirely when inert so a disabled
      // wrapper makes no claim at all (the swipe-actions rule).
      style: enabled
        ? ({
            touchAction: "pinch-zoom",
            WebkitTouchCallout: "none",
          } as React.CSSProperties)
        : undefined,
    },
  };
}

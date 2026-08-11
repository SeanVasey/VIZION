"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { tap } from "@/lib/haptics";

/**
 * Press-and-hold → drag-between-detents, in one continuous gesture
 * (docs/decisions/0012-hold-slider.md).
 *
 * The control has two ways in, and `latchOnTap` decides how many of them
 * this instance offers:
 *
 *  - DRAG phase (always): holding past HOLD_MS — or sliding sideways past
 *    slop in the same unbroken press, which is how the reference control is
 *    actually used — expands an overlay track and the same pointer drags
 *    between detents; release commits.
 *  - LATCHED phase (`latchOnTap`): a plain tap opens the same capsule and
 *    LEAVES it up. The overlay becomes interactive for that phase: a tap on
 *    the track picks the stop under the finger, a drag on it scrubs, and a
 *    tap anywhere else dismisses without committing. Added 2026-08-11 when
 *    the depth sheet was retired — with no sheet behind it, a tap had
 *    nothing to fall through to, and WCAG 2.5.7 needs a no-dragging route
 *    to every value. Instances that still sit in front of a real dropdown
 *    (none today; the shape is kept for a future one) pass `latchOnTap:
 *    false` and a tap falls through to the wrapped trigger's own click.
 *
 * This hook owns the whole gesture from the wrapper element, and owns ONLY
 * gestures that begin in the wrapper's own DOM subtree: a Sheet is a body
 * portal whose events still bubble up the React tree, and those are refused
 * at pointer-down. A slider that LIVES inside a sheet (the budget dial) is
 * not that case and is admitted — see the activation guard.
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
 * never from measuring rendered dots.
 *
 * The track's home is the TRIGGER — the capsule opens centered on the button
 * that owns it, both axes, so it reads as that button expanding in place
 * (owner direction, 2026-08-11: "always sprouts out from the same fixed
 * button point", and the budget dial "pops out directly over where the label
 * showing button for the slider was"). That supersedes ADR-0012 amendment
 * 4's viewport-centered home, which was itself a correction of a first cut
 * that anchored under the FINGER. The distinction the amendment was
 * defending survives intact and is the whole point: placement must not
 * depend on where the press landed, only on where the control lives. A
 * button is a fixed point; a fingertip is not. The finger still maps
 * RELATIVELY through dragOffset, so the press point never jumps the
 * selection.
 *
 * `viewport` is the VISUAL viewport in layout-viewport coordinates —
 * {left: 0, width: innerWidth} unzoomed, `visualViewport`'s offset/width
 * under pinch zoom. This control deliberately preserves native pinch zoom
 * (the resting `pinch-zoom` claim), and a fixed-position capsule can open
 * entirely outside a zoomed-in user's view (Codex review, PR #103) — so the
 * anchor-centered home is CLAMPED into the visible region, never placed
 * outside it. On a phone the composer rail's pill sits within a hair of the
 * region's own center, so the clamp is usually a no-op and the two homes
 * agree; the clamp is what makes the rule safe for a trigger near an edge
 * (the budget dial, inset in the side sheet).
 *
 * What adapts under pressure is the spacing (Codex review, third and fourth
 * passes: any placement that hides a center makes that value unreachable,
 * because the pointer cannot travel past the region's edge):
 *
 * - FULL: the 44px ladder plus capsule chrome fits inside the margins —
 *   spacing stays DETENT_SPACING_PX.
 * - COMPRESSED: spacing shrinks toward MIN_DETENT_SPACING_PX so capsule,
 *   pads, and margins all still fit. Both modes clamp the anchored home
 *   into the margins, which is possible precisely BECAUSE the chrome fits
 *   (proof: chromeSpacing >= spacing gives width <= region - 2*margin, so
 *   the clamp's own range is non-empty).
 * - SPAN-ONLY: below that, the geometry stops reserving the capsule's
 *   chrome — the rounded ends and margins may overflow the region (the
 *   overlay is decoration) while the detent CENTERS compress into the
 *   region minus CENTER_INSET_PX. There is no room left to honor an
 *   anchor, so this mode keeps the region-centered span: every stop stays
 *   visible, and zoom multiplies physical travel, so the tighter detents
 *   cost no precision.
 *
 * Single-GESTURE reach is bounded by where the press began — a finger
 * cannot travel past the screen's edge, at any zoom, under any geometry
 * (the reference control has the same physics). That bound is answered by
 * COMPOSITION, not by gain: release re-anchors, so the next hold starts
 * from the new selection with fresh travel room, and the LATCHED phase (a
 * plain tap) reaches any stop with a single tap on the track — which is
 * also what satisfies WCAG 2.5.7 now that the depth sheet is retired. Drag
 * gain is deliberately constant and side-symmetric: the finger owns the
 * thumb 1:1, in both directions, always.
 */
export function computeTrackGeometry(
  anchorRect: { left: number; top: number; width: number; height: number },
  detentCount: number,
  viewport: { left: number; width: number },
): TrackGeometry {
  const steps = Math.max(detentCount - 1, 1);
  const chromeSpacing = (viewport.width - EDGE_MARGIN_PX * 2 - TRACK_PAD_PX * 2) / steps;
  const chromeFits = chromeSpacing >= MIN_DETENT_SPACING_PX;
  const spacing = chromeFits
    ? Math.min(DETENT_SPACING_PX, chromeSpacing)
    : Math.max(
        1,
        Math.min(DETENT_SPACING_PX, (viewport.width - CENTER_INSET_PX * 2) / steps),
      );
  const span = steps * spacing;
  const width = span + TRACK_PAD_PX * 2;
  // Centering the capsule on the anchor and centering its SPAN on the anchor
  // are the same thing (symmetric pads).
  const anchorCenter = anchorRect.left + anchorRect.width / 2;
  const minLeft = viewport.left + EDGE_MARGIN_PX;
  const maxLeft = viewport.left + viewport.width - EDGE_MARGIN_PX - width;
  const left = chromeFits
    ? Math.min(Math.max(anchorCenter - width / 2, minLeft), maxLeft)
    : viewport.left + (viewport.width - width) / 2;
  const top = anchorRect.top + anchorRect.height / 2 - TRACK_HEIGHT_PX / 2;
  return {
    left,
    top,
    width,
    height: TRACK_HEIGHT_PX,
    detentCenters: Array.from(
      { length: detentCount },
      (_, i) => left + TRACK_PAD_PX + i * spacing,
    ),
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
 * The latched capsule's keyboard vocabulary — the WAI-ARIA slider ladder,
 * which is what the trigger now declares (`role="slider"`) and therefore
 * what it owes. Both axes move the value: the control is horizontal, but
 * Up/Down are the pattern's, and on a ladder whose semantics are "more" and
 * "less" they read the same way the bars do. RTL is deliberately NOT mapped
 * — the ladder's low end is its visual left in every locale because the
 * whole track is a meter that FILLS from that end, and the app ships no RTL
 * surface today; the day it does, this map is the one place that changes.
 */
const LADDER_KEY_STEP: Record<string, 1 | -1 | "home" | "end" | undefined> = {
  ArrowRight: 1,
  ArrowUp: 1,
  ArrowLeft: -1,
  ArrowDown: -1,
  Home: "home",
  End: "end",
  PageUp: 1,
  PageDown: -1,
};

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

/** Which way the capsule was opened — see the header. */
export type HoldPhase = "drag" | "latched";

export interface HoldActive {
  phase: HoldPhase;
  dragIndex: number;
  geometry: TrackGeometry;
}

export function useHoldDrag({
  detentCount,
  selectedIndex,
  enabled,
  latchOnTap = false,
  onCommit,
}: {
  detentCount: number;
  /** The committed detent at gesture start — the drag maps relative to it
   *  (dragOffset), wherever in the anchored track it sits. */
  selectedIndex: number;
  /** False = fully inert: no timer, no axis claim, taps untouched. */
  enabled: boolean;
  /** True = a plain tap opens the capsule LATCHED instead of falling through
   *  to the wrapped trigger's click. See the header. */
  latchOnTap?: boolean;
  /** Called once on release with the landed detent. Must be stable. */
  onCommit: (index: number) => void;
}) {
  const [active, setActive] = useState<HoldActive | null>(null);

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

  /** Streams this wrapper refused, whose clicks have not yet arrived (or
   *  been proven never coming). The claim alone cannot carry a refusal to
   *  its end: the owner can release before a refused pointer lifts, and at
   *  click time both the claim and suppressClick are clear — the press
   *  documented as refused whole then opened this pill's sheet (thirteenth
   *  pass cross-pill; nineteenth same-wrapper, told apart from the owner's
   *  own settle-window click by GATE, not identity). Per-instance, so it
   *  can never collide with another wrapper's legitimate clicks. A SET,
   *  not a slot (twenty-second pass): two competing streams can be refused
   *  concurrently, and the newest-wins slot un-protected the elder — the
   *  newer stream's end cleared the whole marker while the elder was still
   *  down, and its click opened the sheet right after the owning drag.
   *  Each refusal is retained until ITS OWN stream ends: the window hears
   *  the end anywhere (a refusal must not outlive its stream — the stale
   *  marker ate a keyboard activation, fourteenth round), and the ended id
   *  leaves one task later, outliving exactly the one same-task click its
   *  lift can still deliver (the settle() ordering trick). Clicks are
   *  consumed while ANY refusal is pending; consumption reads the set and
   *  never writes it (nineteenth pass). Only an ADMITTED-path pointer-down
   *  clears the set wholesale — that reset exists for STRANDED ids (a
   *  stream that ended where no event reports it, whose staleness only a
   *  fresh legitimate interaction can prove); the boundary it keeps is
   *  recorded in the ADR. */
  const refusedIds = useRef<Set<number>>(new Set());
  const refusedClears = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const onRefusedEnd = useCallback((e: PointerEvent) => {
    const id = e.pointerId;
    if (!refusedIds.current.has(id) || refusedClears.current.has(id)) return;
    refusedClears.current.set(
      id,
      setTimeout(() => {
        refusedIds.current.delete(id);
        refusedClears.current.delete(id);
        if (refusedIds.current.size === 0) {
          window.removeEventListener("pointerup", onRefusedEnd);
          window.removeEventListener("pointercancel", onRefusedEnd);
        }
      }, 0),
    );
  }, []);
  const armRefusedWatch = useCallback(
    (pointerId: number) => {
      refusedIds.current.add(pointerId);
      // Duplicate adds of the same handler are spec'd no-ops, so arming is
      // idempotent while any refusal is pending.
      window.addEventListener("pointerup", onRefusedEnd);
      window.addEventListener("pointercancel", onRefusedEnd);
    },
    [onRefusedEnd],
  );
  const disarmRefusedWatch = useCallback(() => {
    refusedIds.current.clear();
    for (const t of refusedClears.current.values()) clearTimeout(t);
    refusedClears.current.clear();
    window.removeEventListener("pointerup", onRefusedEnd);
    window.removeEventListener("pointercancel", onRefusedEnd);
  }, [onRefusedEnd]);

  /** Give up the exclusive claim — called wherever `press.current` dies. */
  const releaseGesture = useCallback(() => {
    if (gestureOwner === ownerToken.current) gestureOwner = null;
  }, []);

  const setActiveBoth = useCallback((next: HoldActive | null) => {
    activeRef.current = next;
    setActive(next);
  }, []);

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

  /** The window key handler and the things it drives reference each other;
   *  refs break the cycles while keeping every listener identity stable for
   *  add/remove pairing. */
  const teardownRef = useRef<() => void>(() => {});
  const disarmWindowNetRef = useRef<() => void>(() => {});
  const releaseGestureRef = useRef(releaseGesture);
  releaseGestureRef.current = releaseGesture;
  const setActiveBothRef = useRef(setActiveBoth);
  setActiveBothRef.current = setActiveBoth;
  const commitLatchedRef = useRef<() => void>(() => {});

  const onWindowKey = useCallback((e: KeyboardEvent) => {
    const current = activeRef.current;
    if (!current) return;
    if (e.type === "keydown" && e.key === "Escape") {
      // Revert. In the DRAG phase the finger may stay down for seconds yet,
      // so the trailing click is suppressed at the eventual pointer-up, not
      // on a timer here; the LATCHED phase has no pointer left to wait for,
      // so it releases the claim outright.
      if (current.phase === "latched") {
        releaseGestureRef.current();
      } else {
        cancelled.current = true;
      }
      teardownRef.current();
      // Stopped, not merely defaulted: a latched capsule can be open INSIDE
      // a Sheet (the budget dial), whose panel closes on a bubbled Escape.
      // One Escape must dismiss one surface — the capsule, which is the one
      // in front.
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // The latched phase is a live control, not a frozen picture: it owns the
    // ladder keys outright so a keyboard user reaches every stop without the
    // retired sheet, and Enter/Space commits what they landed on. Everything
    // NOT in this vocabulary still dies below, exactly as in the drag phase.
    if (current.phase === "latched" && e.type === "keydown") {
      const step = LADDER_KEY_STEP[e.key];
      if (step !== undefined) {
        e.preventDefault();
        e.stopPropagation();
        const count = latest.current.detentCount;
        const next =
          step === "home"
            ? 0
            : step === "end"
              ? count - 1
              : Math.max(0, Math.min(count - 1, current.dragIndex + step));
        if (next !== current.dragIndex) {
          tap(5);
          setActiveBothRef.current({ ...current, dragIndex: next });
        }
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        commitLatchedRef.current();
        return;
      }
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
    // The concealment net outlives a DRAG teardown on purpose — the Escape
    // path leaves the finger down, and that press must still be caught if
    // the window then goes away. With no press left there is nothing for it
    // to watch, so it comes down here: that is what ends it for the latched
    // phase (commit, dismiss, Escape) and for the uncaptured-exit net, which
    // never disarmed it (harmless before, but it is the same listener the
    // latched branch now reads).
    if (!press.current) disarmWindowNetRef.current();
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
      // A LATCHED capsule has no press left to abandon — it is pure open
      // state, so concealment simply closes it (no commit, nothing to
      // suppress: there is no stream that can still deliver a click).
      // Registered for the latched phase too, because a capsule left up in a
      // backgrounded tab is the same leak this net exists for, minus the
      // pointer.
      if (!press.current) {
        if (activeRef.current?.phase === "latched") {
          releaseGesture();
          teardownRef.current();
          window.removeEventListener("blur", onWindowConceal);
          document.removeEventListener("visibilitychange", onWindowConceal);
        }
        return;
      }
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
      armRefusedWatch(concealed.pointerId);
    },
    [releaseGesture, onWindowPointerEnd, armRefusedWatch],
  );

  /** Disarm the nets wherever the press dies through the wrapper itself. */
  const disarmWindowNet = useCallback(() => {
    window.removeEventListener("pointerup", onWindowPointerEnd);
    window.removeEventListener("pointercancel", onWindowPointerEnd);
    window.removeEventListener("blur", onWindowConceal);
    document.removeEventListener("visibilitychange", onWindowConceal);
  }, [onWindowPointerEnd, onWindowConceal]);
  disarmWindowNetRef.current = disarmWindowNet;

  /** The latched phase keeps only the CONCEALMENT half of the net — there is
   *  no pointer left for the edge-exit half to catch. */
  const armLatchedConcealWatch = useCallback(() => {
    window.addEventListener("blur", onWindowConceal);
    document.addEventListener("visibilitychange", onWindowConceal);
  }, [onWindowConceal]);

  /** `currentX`: set when a pre-hold SLIDE engages the track — the finger
   *  has already travelled, so the first dragIndex maps its position now
   *  rather than snapping back to the anchor (a quick flick would otherwise
   *  expand, commit the unchanged selection, and read as a no-op). The
   *  timer path passes nothing: the finger is still on the anchor. */
  const activate = useCallback(
    (currentX?: number, phase: HoldPhase = "drag") => {
      const p = press.current;
      if (!p) return false;
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
      //
      // Scoped to dialogs that do NOT contain this wrapper (2026-08-11): the
      // budget dial now LIVES in the Target sheet, so "a sheet is open" and
      // "a sheet is in front of me" stopped being the same statement. A
      // dialog containing the trigger is the surface the slider belongs to,
      // not one covering it, and the capsule (z-85) rides above the sheet
      // (z-70) exactly as it rides above the composer. Every other dialog is
      // still senior and still stands the gesture down.
      const dialogOpen = Array.from(document.querySelectorAll('[role="dialog"]')).some(
        (d) => !d.closest('[aria-hidden="true"]') && !d.contains(p.el),
      );
      if (dialogOpen) {
        cancelled.current = true;
        try {
          p.el.setPointerCapture(p.pointerId);
        } catch {
          /* jsdom, or a pointer already ended */
        }
        return false;
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
      // Skipped when latching: that pointer is already UP (the tap is what
      // opened the capsule), so there is no stream left to route.
      if (phase === "drag") {
        try {
          p.el.setPointerCapture(p.pointerId);
        } catch {
          /* jsdom, or a pointer that ended during the hold */
        }
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
        phase,
        dragIndex:
          currentX === undefined
            ? selected
            : detentIndexForX(currentX - dragOffset.current, geometry),
        geometry,
      });
      return true;
    },
    [onWindowKey, onWindowTouchMove, onWindowWheel, setActiveBoth],
  );

  // ---- the latched phase's own controls -----------------------------------
  // The capsule outlives the pointer that opened it, so these three are the
  // only ways it can end. Each releases the app-wide claim, which the latched
  // phase holds for its whole life: while a capsule is up no other slider may
  // engage, and the focus pair's input shield is the reason a stray press
  // cannot reach the world behind it.

  /** Scrub to the stop under an ABSOLUTE x — the finger is on the track
   *  itself now, not offset from a pill it pressed, so there is no
   *  dragOffset in this phase. */
  const latchedScrubTo = useCallback(
    (clientX: number) => {
      const current = activeRef.current;
      if (!current || current.phase !== "latched") return;
      const next = detentIndexForX(clientX, current.geometry);
      if (next === current.dragIndex) return;
      tap(5);
      setActiveBoth({ ...current, dragIndex: next });
    },
    [setActiveBoth],
  );

  const latchedCommit = useCallback(() => {
    const current = activeRef.current;
    if (!current || current.phase !== "latched") return;
    releaseGesture();
    latest.current.onCommit(current.dragIndex);
    teardownRef.current();
  }, [releaseGesture]);
  commitLatchedRef.current = latchedCommit;

  /** Dismiss with no commit — the outside tap, and the concealment revert. */
  const latchedDismiss = useCallback(() => {
    const current = activeRef.current;
    if (!current || current.phase !== "latched") return;
    releaseGesture();
    teardownRef.current();
  }, [releaseGesture]);

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
    if (!enabled) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // One gesture at a time, app-wide (see gestureOwner): while ANY press
    // or drag is live — another pill's, or a competing second device on
    // THIS pill (`press.current`; nineteenth pass, which removed the bare
    // unmarked reject that stood here) — this press is refused outright,
    // and its eventual click dies in onClickCapture, marked here so the
    // refusal survives even if the owner releases first. The end-watch
    // bounds each refusal to its own stream's lifetime. Refusals
    // ACCUMULATE (twenty-second pass): a sibling refusal joins the set
    // instead of stealing the slot, so the newer stream's end can never
    // un-protect an elder still down. The `press.current` half also
    // guards the invariant no claim state can: a live press record must
    // never be overwritten mid-stream.
    if (gestureOwner !== null || press.current) {
      armRefusedWatch(e.pointerId);
      return;
    }
    // Only an ADMITTED-path stream supersedes pending refusals. This reset
    // exists for STRANDED ids — a refused stream that ended where no event
    // reports it (released in another app) would otherwise eat this new
    // stream's own legitimate tap-click. A fresh press reaching admission
    // is the one proof of staleness available; the boundary this keeps is
    // recorded in the ADR (twenty-second pass).
    disarmRefusedWatch();
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
    const current = activeRef.current;
    // The claim is released on every path EXCEPT a successful latch, which
    // inherits it: the capsule is still up, and it is the thing the claim
    // exists to make exclusive. Ordered before `press.current = null` only
    // for readability — nothing here reads the record after this point
    // except the latch, which takes the element first.
    const el = p.el;
    press.current = null;
    disarmWindowNet();
    clearTimeout(timer.current);
    if (current) {
      releaseGesture();
      latest.current.onCommit(current.dragIndex);
      teardown();
      settle();
      return;
    }
    if (cancelled.current) {
      // Escape'd or moved-past-slop while down; the lift still fires a
      // click — swallow it.
      releaseGesture();
      cancelled.current = false;
      settle();
      return;
    }
    if (latchOnTap) {
      // A plain tap OPENS the capsule and leaves it up. The press record has
      // to survive `activate`, which reads it for the anchor rect and the
      // detent geometry — so it is restored for exactly that call and
      // cleared again. The trailing click is swallowed either way: on the
      // latch path so the tap cannot also fire whatever the trigger does on
      // click, and on the refusal path (activate stood down over a foreign
      // sheet) because a press this hook classified as not-a-tap must never
      // fall through — the same rule the y-dominant stand-down applies.
      press.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, el };
      const opened = activate(undefined, "latched");
      press.current = null;
      if (opened) armLatchedConcealWatch();
      else releaseGesture();
      settle();
      return;
    }
    releaseGesture();
    // else: a plain tap — the click proceeds and reaches the wrapped trigger.
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
    // (refusedIds; thirteenth pass). The ninth pass consumed only
    // foreign-claim clicks; the tenth closed the self-carve-out: with our
    // own claim live, a click on this pill can only be a SECOND input
    // device (a mouse click landing inside a touch press's pre-hold
    // window, Enter on the focused pill mid-drag), and it opened this
    // pill's own sheet under the arriving capsule. The legitimate plain-tap
    // click is safe by protocol order, not by identity: pointer-up releases
    // the claim synchronously before the browser dispatches the click, so
    // at click time gestureOwner is already null.
    //
    // Refusals gate only POINTER-DERIVED clicks (detail ≥ 1): keyboard and
    // programmatic activation carry detail 0 and always pass. This is the
    // discriminator the refusal lifecycle turned out to need (fourteenth,
    // sixteenth, seventeenth passes): an id whose stream ended where no
    // event reports it — released in another app — can sit stranded, and
    // every timing-based expiry had a hole (the foreground-clear let a
    // user who returned STILL HOLDING lift into an un-suppressed click).
    // detail needs no timing: a stranded id can never touch a keyboard
    // user, the next ADMITTED pointer stream clears it at its own
    // pointer-down, and the clicks the set exists to eat — its own
    // streams' — are pointer-derived by definition.
    //
    // Consumption READS the set and never writes it (nineteenth pass —
    // this body used to clear the old boolean on any consumed click).
    // Cross-pill that was harmless, but a same-pill competitor shares
    // this handler with the owner: the owner's settle-consumed commit
    // click stripped the competitor's protection before its own click
    // arrived. Each id's lifecycle has exactly three ends — its own
    // end-watch zero-timeout, an admitted pointer-down's supersede, and
    // unmount.
    if (
      suppressClick.current ||
      (refusedIds.current.size > 0 && e.detail > 0) ||
      gestureOwner !== null
    ) {
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
    /** The latched capsule's controls — the overlay's own track and scrim
     *  drive these once the opening pointer is gone. No-ops in every other
     *  phase, so a stale handler can never commit. */
    latched: {
      scrubTo: latchedScrubTo,
      commit: latchedCommit,
      dismiss: latchedDismiss,
    },
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

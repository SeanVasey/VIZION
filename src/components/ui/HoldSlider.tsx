"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useHoldDrag, type HoldActive } from "@/components/ui/use-hold-drag";

/**
 * The hold-slider control class (docs/decisions/0012-hold-slider.md, and its
 * 2026-08-11 redesign — ADR-0014).
 *
 * `HoldSliderTrigger` wraps a trigger pill and expands it into a slider. Two
 * ways in, both landing on the same capsule (see use-hold-drag's header for
 * the gesture machinery):
 *
 *  - HOLD or press-and-slide → the DRAG phase: the same unbroken pointer
 *    scrubs the detents, release commits.
 *  - TAP → the LATCHED phase (opt-in per instance via `latchOnTap`): the
 *    capsule opens and stays, the track becomes interactive, a tap on it
 *    picks the stop under the finger, and a tap anywhere else dismisses.
 *
 * The capsule opens CENTERED ON ITS TRIGGER, both axes — it reads as that
 * button expanding in place, and it does so from the same fixed point every
 * time regardless of where the press landed (owner direction; the geometry
 * note in use-hold-drag carries the full rule).
 *
 * The overlay is aria-hidden DECORATION in both phases: the trigger stays the
 * authoritative readout and — where the host declares `role="slider"`, which
 * is what retired the depth sheet — the complete keyboard and screen-reader
 * path, with committed and stepped values announced through the always-
 * mounted polite live region below. The focus PAIR beneath the track is the
 * opposite — an input shield: while a capsule is up, a second pointer
 * anywhere in the viewport dies on it, so no control can fire under a live
 * gesture (the gesture's own pointer is captured and bypasses hit-testing
 * entirely).
 */

/** One slider stop. `tone` keys the fill's color ramp and is the level's own
 *  identity, never its ladder position — the DepthGlyph rule, so the same id
 *  renders identically on every model's ladder. */
export interface Detent {
  id: string;
  label: string;
  tone: "faint" | "silver" | "laser" | "ultra";
}

/** The fill ramp's color per tone. Laser and ultra are the accent tokens
 *  themselves — this is a TEXT-FREE fill, the one place tokens.css permits
 *  raw --laser (the chip above carries the readout in text-safe ink). */
const TONE_COLOR: Record<Detent["tone"], string> = {
  faint: "color-mix(in srgb, var(--silver) 22%, transparent)",
  silver: "color-mix(in srgb, var(--silver) 55%, transparent)",
  laser: "var(--laser)",
  ultra: "var(--ultra-ink)",
};

/**
 * Fraction of the gap to the next detent that a tone HOLDS at full strength
 * before blending on. See rampGradient — this is the number that keeps the
 * ramp out of sRGB's mud.
 */
const TONE_HOLD = 0.55;

/**
 * The fill's gradient, laid across the WHOLE track once and then revealed by
 * the fill's width — never repainted per step.
 *
 * Two properties have to hold at once, and only this construction gives both.
 * The reference control's fill is a single continuous ramp that the thumb
 * uncovers, so the pixels already painted must not move or re-hue when the
 * value changes: that rules out a gradient anchored to the growing fill box,
 * which restretches every step. And a level's color is its IDENTITY, not its
 * ladder position (the DepthGlyph rule) — "High" must be laser on Grok's
 * three-step ladder and on Fable's five-step one — which rules out a fixed
 * ramp the detents merely sample, since the same level lands at a different
 * fraction on a shorter ladder.
 *
 * So the ramp is BUILT FROM the detents: each stop's tone color is pinned at
 * that detent's own center. The ladder defines the ramp, the ramp is anchored
 * to the track, and the only thing that animates is the width of the window
 * onto it.
 *
 * Each tone then HOLDS for TONE_HOLD of the gap before blending into the
 * next, which is not a stylistic flourish — it is what keeps the ramp out of
 * sRGB's mud. Laser and ultra sit almost opposite each other on the wheel, so
 * a straight sRGB line between them runs through a pale cream (measured, both
 * engines: the top of the ladder washed out exactly where it should have been
 * most intense). Holding each tone and compressing the blend into the back of
 * the gap keeps every detent sitting in its OWN pure color — which is the
 * colour-coding's whole job — and narrows the wash to a seam.
 *
 * Interpolating in a perceptual space was the obvious alternative and is
 * rejected on portability: `in oklch` does give the reference recording's
 * cyan→blue→violet path, but Chromium and WebKit disagree about it here
 * (measured), because the muted stops are near-achromatic color-mix()es whose
 * hue the two engines carry differently — the same fill would read green on
 * one engine and teal on the other. Plain sRGB with explicit stops renders
 * identically everywhere, which a decorative ramp in a two-engine PWA needs
 * more than it needs a prettier midpoint.
 */
function rampGradient(
  detents: readonly Detent[],
  centers: readonly number[],
  rampWidth: number,
): string {
  const pct = (i: number) =>
    Math.max(0, Math.min(100, ((centers[i]! - FILL_INSET_PX) / rampWidth) * 100));
  const stops: string[] = [];
  detents.forEach((d, i) => {
    const color = TONE_COLOR[d.tone];
    const here = pct(i);
    stops.push(`${color} ${here.toFixed(2)}%`);
    const next = centers[i + 1] === undefined ? undefined : pct(i + 1);
    if (next !== undefined) {
      stops.push(`${color} ${(here + (next - here) * TONE_HOLD).toFixed(2)}%`);
    }
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

/** Live-label ink per tone. Laser is NEVER text (1.09:1 on light) — the
 *  text-safe `--accent-ink` carries that tier; ultra-ink is AA everywhere. */
const LABEL_CLASS: Record<Detent["tone"], string> = {
  faint: "text-silver",
  silver: "text-silver",
  laser: "text-accent",
  ultra: "text-ultra",
};

/** How the overlay draws its detents. `dot` is the default vocabulary;
 *  `bar` renders ascending ticks — the Thinking rail's, so mid-drag its
 *  capsule reads as the DepthGlyph meter expanded (a LADDER), while the
 *  budget capsule's equal dots read as equal choices whose fill is the
 *  spend. Form is the disambiguator between the two sliders — never a new
 *  hue (tokens are locked, and the ramp is the level's). */
export type DetentMarker = "dot" | "bar";

/**
 * Mini-track geometry. A scale model of the capsule: one rail, one fill, one
 * thumb on the fill's leading edge, with travel inset by half the thumb so it
 * never overhangs the ends.
 *
 * Two of these numbers exist to keep it from reading as a TOGGLE SWITCH, which
 * is what the first cut looked like at the bottom of the ladder — and the
 * bottom of the Thinking ladder is "Auto", the default every new device opens
 * on. Both were found by looking at a capture, not by a test.
 *
 *  - The thumb is TALLER than the rail. A knob sitting flush inside a
 *    pill-shaped track of its own height is a switch; a round thumb
 *    overhanging a thin rail is a slider.
 *  - Travel is INSET from both ends, so rail stays visible on the far side of
 *    the thumb at every value. A switch knob is always flush against the end
 *    it is parked at; this one never is.
 */
const HINT_W_PX = 40;
const HINT_H_PX = 12;
const HINT_RAIL_H_PX = 5;
const HINT_THUMB_PX = 12;
const HINT_INSET_PX = 10;

/**
 * Resting affordance for the slider — a MINIATURE of the track it opens: a
 * short rail, filled in the level's own tone up to a small thumb.
 *
 * This replaced three slim grip ticks on 2026-08-11. The ticks were right
 * about what to avoid — a chevron promises a dropdown the control does not
 * have — and wrong about what to offer: a grip reads as a grip. The owner's
 * second pass asked for a button that is obvious on sight, offering three
 * routes ("indications to press or an animation to press and hold to drag and
 * slide it or a permanently visible slider"), and picked this one. It is
 * literally the third route at pill scale: the control shows the slider it
 * becomes, at the value it currently holds, in the colour that value has
 * inside the capsule (same `TONE_COLOR` map, so the two can never disagree).
 *
 * A full-size rail on the composer rail was the alternative and was declined:
 * Opus's six-stop ladder needs 264px of the 390px phone, which forces the rail
 * to a second row and pushes the Target pill off its line.
 *
 * Still aria-hidden decoration — the pill's label is the readout, the pill's
 * `role="slider"` is the semantics — and the hosts render it only while their
 * slider is actually enabled, because a hint that outlived its gesture would
 * be a lie.
 */
export function HoldSliderHint({
  value,
  max,
  tone,
  pulse = false,
}: {
  /** The committed detent index. */
  value: number;
  /** The ladder's top index (`aria-valuemax`), never below 1 in practice. */
  max: number;
  /** The committed detent's tone — keys the fill to the capsule's ramp. */
  tone: Detent["tone"];
  /** True until the user has driven any dial once: a soft ring pulses off the
   *  thumb, which is the owner's "animation to press and hold". Retires on the
   *  first commit through the host's `dialTipSeen` flag — the same one the
   *  coach line uses, so the two hints appear and leave together. */
  pulse?: boolean;
}) {
  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const x = HINT_INSET_PX + (HINT_W_PX - HINT_INSET_PX * 2) * fraction;
  return (
    <span
      aria-hidden="true"
      data-hold-hint=""
      className="relative inline-flex shrink-0 items-center"
      style={{ width: HINT_W_PX, height: HINT_H_PX }}
    >
      <span
        className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-[color-mix(in_srgb,var(--silver)_26%,transparent)]"
        style={{ height: HINT_RAIL_H_PX }}
      />
      <span
        data-hold-hint-fill=""
        className="hold-hint-fill absolute left-0 top-1/2 -translate-y-1/2 rounded-full"
        style={{ width: x, height: HINT_RAIL_H_PX, backgroundColor: TONE_COLOR[tone] }}
      />
      {/* --chalk, not the tone: the thumb is the moving OBJECT and the fill
          behind it is the value, exactly as in the capsule (whose thumb is
          glass with a tone core — too fussy to reproduce at 10px). As the
          primary-text role it inverts with the theme, so it stays legible on
          both pill surfaces. */}
      <span
        data-hold-hint-thumb=""
        className={`hold-hint-thumb absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-hair bg-chalk ${
          pulse ? "hold-hint-pulse" : ""
        }`}
        style={{ left: x, width: HINT_THUMB_PX, height: HINT_THUMB_PX }}
      />
    </span>
  );
}

export function HoldSliderTrigger({
  detents,
  selectedIndex,
  liveLabel,
  onCommit,
  enabled,
  detentMarker = "dot",
  dynamicBackdrop = false,
  compactHalo = false,
  latchOnTap = false,
  scrollableHost = false,
  peakCaption,
  className,
  children,
}: {
  detents: readonly Detent[];
  /** The committed detent (what the wrapped pill currently shows). */
  selectedIndex: number;
  /** Full announcement for a detent, e.g. "Fable 5 · Extra High" —
   *  announced through the live region on commit, and on every keyboard
   *  step while the capsule is latched. The VISUAL chip shows only the
   *  detent's own short label: mid-gesture the model/mode context is
   *  already on screen (the neighbouring rail, the eyebrow), and repeating
   *  it beside itself read as a duplicate (owner, 2026-08-10). Ears get the
   *  full sentence; eyes get the level. */
  liveLabel: (detent: Detent) => string;
  /** Landed-detent index on release/commit. Must be identity-stable. */
  onCommit: (index: number) => void;
  /** False = the wrapper is inert and claims nothing; taps are untouched. */
  enabled: boolean;
  /** Detent glyph vocabulary — see DetentMarker. */
  detentMarker?: DetentMarker;
  /** True while the content BEHIND the overlay cannot honestly hold still —
   *  a streaming run repainting its surface as tokens arrive. The focus
   *  blur's whole performance case is that it filters a STATIC backdrop
   *  exactly once (the 2026-08-09 bloom lesson); the world-pause freezes
   *  the idle ornaments, but a live stream is content, not ornament — it
   *  must keep moving, so the overlay stands the blur down and ships the
   *  dim alone (the reduced-effects presentation) for that gesture. */
  dynamicBackdrop?: boolean;
  /** True = a plain TAP opens the capsule latched instead of falling through
   *  to the wrapped trigger's click. Hosts that pass this own the whole
   *  interaction and must declare slider semantics on the trigger. */
  latchOnTap?: boolean;
  /** True when this trigger sits inside a SHEET rather than on a full page —
   *  halves the halo's reach. See COMPACT_HALO_SCALE. */
  compactHalo?: boolean;
  /** True when this trigger sits on a scrollable surface it must not trap —
   *  see useHoldDrag's own note. Pairs with `className="flex w-full"`: a
   *  full-width control in an overflowing pane needs both. */
  scrollableHost?: boolean;
  /** The cost line shown beneath the capsule at the ladder's TOP stop only —
   *  the reference control's "consumes usage limits faster". Returning null
   *  (or omitting the prop) ships no caption. */
  peakCaption?: string | null;
  /** Layout escape hatch for the WRAPPER, which defaults to `inline-flex`
   *  because the composer rail's pills are content-width pills in a
   *  space-between row. A shrink-to-fit wrapper silently defeats a `w-full`
   *  trigger inside it (the tuning dial shipped two-thirds wide in its sheet
   *  before this existed), so a host that wants a block-level dial passes
   *  `flex w-full` here. Deliberately the wrapper's own class rather than a
   *  boolean: the trigger's class string stays the host's business, and this
   *  stays about the one box the primitive owns. */
  className?: string;
  /** The existing trigger pill, rendered unchanged. */
  children: ReactNode;
}) {
  const [announced, setAnnounced] = useState("");

  const handleCommit = useCallback(
    (index: number) => {
      const detent = detents[index];
      if (detent) setAnnounced(liveLabel(detent));
      onCommit(index);
    },
    [detents, liveLabel, onCommit],
  );

  const { active, latched, props } = useHoldDrag({
    detentCount: detents.length,
    selectedIndex,
    enabled,
    latchOnTap,
    scrollableHost,
    onCommit: handleCommit,
  });

  // Keyboard stepping inside a latched capsule moves the value without
  // committing it, and a slider that says nothing between steps is a slider a
  // screen-reader user cannot aim. The drag phase is deliberately silent —
  // it is pointer-only by construction, and announcing every detent a finger
  // sweeps past would be a stream of noise ending in the commit that already
  // announces itself.
  const latchedIndex = active?.phase === "latched" ? active.dragIndex : null;
  useEffect(() => {
    if (latchedIndex === null) return;
    const detent = detents[latchedIndex];
    if (detent) setAnnounced(liveLabel(detent));
  }, [latchedIndex, detents, liveLabel]);

  return (
    // While the capsule is up it visually REPLACES the pill (opacity, so
    // layout holds and the pointer capture target stays painted-off, not
    // gone) — without this, a track narrower than the pill left the pill's
    // tail peeking out beside the capsule.
    <span
      className={`hold-slider-conceal ${className ?? "inline-flex"} ${
        active ? "opacity-0" : ""
      }`}
      {...props}
    >
      {children}
      {/* Always mounted so the first commit's announcement is not dropped
          while the region registers (the A11Y-005 lesson). aria-live only,
          deliberately NOT role="status": the result view's tests (and the
          clarify-questions guard) query role=status SINGULAR, and a live
          announcement needs no role to be spoken. */}
      <span aria-live="polite" data-hold-slider-announce="" className="sr-only">
        {announced}
      </span>
      {active && detents[active.dragIndex] && (
        <HoldSliderOverlay
          detents={detents}
          active={active}
          marker={detentMarker}
          dynamicBackdrop={dynamicBackdrop}
          compactHalo={compactHalo}
          peakCaption={peakCaption ?? null}
          latched={latched}
        />
      )}
    </span>
  );
}

/** Dot radius; the fill capsule extends this far past the active dot. */
const DOT_R = 4;
/** Inset between the track's border and the fill capsule. */
const FILL_INSET_PX = 6;
/** Thumb diameter — the reference control's moving object. Rides the fill's
 *  leading edge so position reads as a THING at a place, not only an edge. */
const THUMB_PX = 28;
/** Bar-marker geometry: 3px ticks rising from BAR_MIN to BAR_MAX across the
 *  track, so the ladder's shape is legible inside the 48px capsule. */
const BAR_W_PX = 3;
const BAR_MIN_PX = 8;
const BAR_MAX_PX = 20;

/**
 * How far the treated halo reaches past the capsule, per axis.
 *
 * These are MEASURED, not chosen (2026-08-11, second owner pass: "the radius of
 * blurring and the glass effect … needs to extend further … to completely
 * obscure the underneath text and shapes or icons of the button and the
 * surrounding areas of the prompt input area"). Eight parameterizations were
 * rendered against the real app and scored by the high-pass energy of each
 * screen band relative to the same band with no capsule open — an objective
 * stand-in for "is there readable text here", since a large blur smears bright
 * content around and RAISES plain variance without making anything legible.
 * The numbers below took the Target row from 0.51 to 0.25, the coach line from
 * 0.32 to 0.06, and the first three lines of the prompt from 0.61 / 0.82 / 0.97
 * to 0.04 / 0.05 / 0.07, while leaving the page header at 1.00 and the bottom
 * nav at 0.92. The runbook in tasks/lessons.md carries the method.
 *
 * Two things set the ceilings, and both are structural rather than taste:
 *
 *  - Y is capped so the BOX still ends clear of the chrome bars, and the cap is
 *    the binding constraint rather than a round number. The first cut of this
 *    pass used 209 and the e2e invariant caught it overlapping the bottom nav
 *    by 4px — which is exactly what that assertion is for, because once the
 *    halo reaches a chrome bar, localization starts depending on the mask, and
 *    the mask is the one property WebKit cannot verify (see the
 *    .hold-slider-blur note). 196 leaves ~9px under the nav and ~79px below the
 *    header, and measures indistinguishably from 209 on every band but one.
 *  - X is deliberately larger than the viewport, which looks wasteful and is
 *    not. The capsule clamps right-of-centre on a phone (x=245 of 393), so an
 *    ellipse sized to the capsule falls off soonest on the LEFT and left the
 *    left column of the prompt readable. X is set so the mask's PLATEAU still
 *    spans the full width from that off-centre origin.
 */
const HALO_X_PX = 220;
const HALO_Y_PX = 196;
/**
 * The reach a capsule inside a SHEET gets instead (`compactHalo`).
 *
 * Not a taste knob — the numbers above were measured against the composer, a
 * full page with a header, a mode rail, a card and a textarea to obscure, and
 * they are wrong on a 320px-tall sheet panel. At full reach the tuning dial's
 * halo swallowed the sheet's own title, the whole model list, AND the Auto card
 * the dial exists to tune, which is the one thing that has to stay visible
 * while you tune it (seen in capture, 2026-08-11). A sheet is also already a
 * focus surface — its own scrim has handled the world behind it — so the halo's
 * only job here is the panel's immediate surroundings.
 */
const COMPACT_HALO_SCALE = 0.5;
/**
 * The dim's ellipse, relative to the blur's box. Slightly WIDER on purpose:
 * where an engine ignores the mask the blur ends on its box edge, and the
 * dim still having a little left there turns a rectangle into a seam. On
 * engines that honour the mask (Chromium, measured) both fade together and
 * the spread is invisible.
 */
const DIM_SPREAD = 1.16;

/**
 * The expanded track — pure presentation plus, in the latched phase, its own
 * pointer handling; the suites (unit and e2e) reach it through the
 * `data-hold-slider-overlay` DOM hook, not an import. Portalled to
 * `document.body` because the composer chassis is `overflow-hidden`
 * (EnhanceComposer) and would clip a track wider than the rail; fixed
 * positioning comes from TrackGeometry's anchored home — centered on the
 * trigger, clamped into the visible region, the same spot for every press.
 *
 * z-[85] (track) over z-[84] (its focus pair): above the toast tier, and
 * above a Sheet (z-[70]) — which is now a place a capsule can legitimately
 * be, since the budget dial lives inside the Target sheet. A FOREIGN sheet
 * still cannot be open under a capsule, enforced from both directions: no
 * gesture starts under one (useHoldDrag refuses a pointer-down outside the
 * wrapper's subtree, and an open sheet's scrim covers the pill), and none
 * opens during one (a refused press's click is consumed for the claim's
 * lifetime, and the focus pair shields every non-captured pointer).
 *
 * In the DRAG phase the track is `pointer-events: none` — it can never steal
 * the gesture it visualizes, and second pointers pass through onto the focus
 * pair's shield. In the LATCHED phase there is no gesture to steal: the
 * opening pointer is long gone, so the track takes pointer events itself and
 * the scrim below it becomes the dismiss target.
 */
function HoldSliderOverlay({
  detents,
  active,
  marker,
  dynamicBackdrop,
  compactHalo,
  peakCaption,
  latched,
}: {
  detents: readonly Detent[];
  active: HoldActive;
  marker: DetentMarker;
  dynamicBackdrop: boolean;
  compactHalo: boolean;
  peakCaption: string | null;
  latched: {
    scrubTo: (clientX: number) => void;
    commit: () => void;
    dismiss: () => void;
  };
}) {
  const { dragIndex, geometry, phase } = active;
  const isLatched = phase === "latched";
  /** The pointer that owns the current scrub, or null. Identity-checked on
   *  every later event the way useHoldDrag checks its own press record: a
   *  second device's stray up/cancel must not end — or commit — a scrub it
   *  never started. */
  const scrubPointer = useRef<number | null>(null);

  const onTrackPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!isLatched || scrubPointer.current !== null) return;
      // The capsule is a body portal, but React still bubbles its events up
      // the COMPONENT tree into the wrapper's own pointer handlers — where
      // they would be logged as a refused competing press. Stopping here is
      // the local fix; the wrapper's admission guard stays exactly as it is
      // for the portalled SHEETS it was written for.
      e.stopPropagation();
      scrubPointer.current = e.pointerId;
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* jsdom */
      }
      latched.scrubTo(e.clientX);
    },
    [isLatched, latched],
  );

  const onTrackPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isLatched || scrubPointer.current !== e.pointerId) return;
      e.stopPropagation();
      latched.scrubTo(e.clientX);
    },
    [isLatched, latched],
  );

  const onTrackPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isLatched || scrubPointer.current !== e.pointerId) return;
      e.stopPropagation();
      scrubPointer.current = null;
      latched.commit();
    },
    [isLatched, latched],
  );

  /**
   * Cancellation REVERTS — it never commits (Codex review, PR #109).
   *
   * `pointercancel` is the OS taking the stream away: a system gesture, a
   * call arriving, the UA deciding mid-scrub that this was a pan. The user
   * released nothing, so there is nothing to save, and the whole gesture
   * system already treats cancel this way — useHoldDrag's own
   * onPointerCancel tears the drag down without calling onCommit. Routing
   * this to the commit handler (the first cut did) would have written
   * whichever detent the finger happened to be over when the OS interrupted:
   * a depth or a routing preference the user never confirmed, saved silently.
   *
   * Dismissing outright, rather than snapping back and staying open, is the
   * same choice the drag phase makes: the capsule came up under a pointer
   * that no longer exists.
   */
  const onTrackPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      if (!isLatched || scrubPointer.current !== e.pointerId) return;
      e.stopPropagation();
      scrubPointer.current = null;
      latched.dismiss();
    },
    [isLatched, latched],
  );

  if (typeof document === "undefined") return null;
  const detent = detents[dragIndex];
  if (!detent) return null;
  const tone = detent.tone;
  const peak = dragIndex === detents.length - 1;
  // The halo — the treated region around the capsule, in viewport pixels. The
  // capsule is anchor-centred, so its centre IS the button's centre and no
  // extra geometry has to be carried out of use-hold-drag.
  const haloScale = compactHalo ? COMPACT_HALO_SCALE : 1;
  const haloX = HALO_X_PX * haloScale;
  const haloY = HALO_Y_PX * haloScale;
  const haloWidth = geometry.width + haloX * 2;
  const haloHeight = geometry.height + haloY * 2;
  const haloLeft = geometry.left - haloX;
  const haloTop = geometry.top - haloY;
  const haloVars = {
    "--dial-cx": `${geometry.left + geometry.width / 2}px`,
    "--dial-cy": `${geometry.top + geometry.height / 2}px`,
    "--dial-rx": `${(haloWidth / 2) * DIM_SPREAD}px`,
    "--dial-ry": `${(haloHeight / 2) * DIM_SPREAD}px`,
  } as React.CSSProperties;
  // Offsets inside the track, from viewport-x detent centers.
  const centers = geometry.detentCenters.map((x) => x - geometry.left);
  const rampWidth = geometry.width - FILL_INSET_PX * 2;
  const fillWidth = Math.max(
    centers[dragIndex]! + DOT_R + 2 - FILL_INSET_PX,
    geometry.height - FILL_INSET_PX * 2,
  );

  return createPortal(
    <>
      {/* The focus pair (owner direction, 2026-08-10): mid-gesture the
          composer drops back so the eye holds only the track, the thumb,
          the level chip, and its tone. Blur below (STATIC — never animated;
          the globals.css note carries the 2026-08-09 lesson), the dim above
          it carrying the entrance fade. Both z-[84], DOM order stacks the
          dim over the blur; the track rides z-[85]. Stand-downs drop the
          blur and keep the dim — the pre-blur shipped look, which is also
          what ships when the backdrop itself cannot hold still: the
          world-pause (data-hold-gesture) freezes the idle ornaments, but a
          streaming run's surface keeps repainting, and a moving backdrop
          under a backdrop-filter re-filters every frame — so a declared
          dynamicBackdrop stands the blur down instead.

          Both are LOCAL now (owner direction, 2026-08-11 — "the entire
          screen shouldn't white out to only show the slider when it's held.
          It should popup and blur out the direct area underneath it and
          that blurring fades into the area … that becomes clear again").
          What shipped was a flat 62%-Void fill edge to edge, which on the
          light theme is 62% of a near-white (#eef0f4) over the whole
          viewport. The treatment is now an ellipse around the capsule that
          falls off to untouched screen, and the two layers reach that the
          same way from opposite ends:

           - the DIM stays fixed inset-0 and localizes in its PAINT, a
             radial-gradient background centred on the capsule. It has to
             stay viewport-covering because it is also the shield (below),
             and a background gradient never affects hit-testing.
           - the BLUR localizes in its BOX, sized to the halo, and softens
             its edge with a mask. Measured 2026-08-11: Chromium gates a
             backdrop-filter with mask-image exactly as intended. WebKitGTK
             could not answer — that build renders NO backdrop-filter at
             all, masked or not, promoted or not (filter: blur works, so it
             is the compositor, not the syntax), which is also why the box
             carries the localization and the mask only softens it: an
             engine that drops the mask still gets a LOCAL blur, and an
             engine that drops the filter gets today's dim-only stand-down.

          pointer-events AUTO, deliberately: the pair doubles as the
          gesture's input shield. A second pointer mid-DRAG otherwise reaches
          whatever it lands on — on hybrid-input devices its synthesized
          click opened a picker sheet under the live capsule. The gesture's
          own pointer is captured at activation (implicitly for touch), and
          captured streams bypass hit-testing, so the shield can never steal
          the drag it guards. In the LATCHED phase the same surface earns a
          second job: it is the outside-tap DISMISS target, which is the
          only reason a latched capsule is escapable by pointer at all. The
          shield is carried by the DIM specifically — it is the layer that
          mounts unconditionally and the one holding the dismiss handler, so
          shrinking the blur's box costs it nothing. (Masking does not clip
          hit-testing in either engine — measured alongside the above.) */}
      {!dynamicBackdrop && (
        <div
          aria-hidden="true"
          data-hold-slider-blur=""
          className="hold-slider-blur pointer-events-auto fixed z-[84]"
          style={{
            left: haloLeft,
            top: haloTop,
            width: haloWidth,
            height: haloHeight,
          }}
        />
      )}
      <div
        aria-hidden="true"
        data-hold-slider-scrim=""
        className="hold-slider-scrim pointer-events-auto fixed inset-0 z-[84]"
        style={haloVars}
        onPointerDown={
          isLatched
            ? (e) => {
                e.stopPropagation();
                latched.dismiss();
              }
            : undefined
        }
      />
      <div
        aria-hidden="true"
        data-hold-slider-overlay=""
        data-hold-slider-phase={phase}
        className={`fixed z-[85] ${isLatched ? "pointer-events-auto" : "pointer-events-none"}`}
        style={{
          left: geometry.left,
          top: geometry.top,
          width: geometry.width,
          height: geometry.height,
          // Latched scrubbing is a drag on the track itself, so the UA must
          // not read it as a pan and steal the pointer mid-scrub — but
          // `pinch-zoom`, never `none` (Codex review, PR #109). `none` also
          // denies ZOOM, and `touch-action` is resolved at gesture start on
          // the element the touch began on, which is earlier than — and
          // therefore not helped by — the window handler's multi-touch
          // exemption. A finger of a pinch landing on the capsule would still
          // have killed the zoom. This value refuses exactly the single-finger
          // pan the scrub needs and nothing else; it is the same claim the
          // resting wrapper makes, for the same reason.
          touchAction: isLatched ? "pinch-zoom" : undefined,
        }}
        onPointerDown={onTrackPointerDown}
        onPointerMove={onTrackPointerMove}
        onPointerUp={onTrackPointerUp}
        onPointerCancel={onTrackPointerCancel}
      >
        {/* The live readout rides in a chip of its own, not as bare text: the
          overlay floats over whatever the composer has at that y, and an
          unbacked line collided with it instead of reading as UI. Same
          glass-solid ground as the track, so the tone ink always sits on a
          designed surface. The chip says only the LEVEL — the model/mode
          context is already on screen (the rail above, the eyebrow) and is
          spoken in full by the commit announcement; printing it here again
          stacked "Opus 5" beside "Opus 5" (owner, 2026-08-10). */}
        {/* Centred on the capsule but NOT bounded by it: the track is as wide
            as its ladder is long, and the three-stop budget dial's capsule is
            132px — narrow enough to truncate its own readout ("Strongest
            models — s…"). These two lines are floating overlay text, so they
            take the VIEWPORT as their bound and the capsule only as their
            centre. */}
        <p className="pointer-events-none absolute -top-9 left-1/2 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 justify-center">
          <span
            data-hold-slider-label=""
            className={`glass-solid hold-slider-lift font-body max-w-full truncate rounded-full px-3 py-1 text-sm font-medium ${LABEL_CLASS[tone]}`}
          >
            {detent.label}
          </span>
        </p>
        {/* `hold-slider-glass`, not `glass-solid`: the capsule is the one
            surface in the app that sits on a blur of its own making, and the
            owner asked for it to look like it ("the popup with the blurred
            background and the slider has glass backgrounds super opaque
            blurring the content"). The halo paints at z-84 and this at z-85,
            so the frost samples an already-blurred backdrop — a lens over a
            lens, which is what gives the capsule its depth. `hold-slider-lift`
            is the shadow that drops it over that halo; it composes the glass
            sheen rather than replacing it (box-shadow is one property). */}
        <div className="hold-slider-glass hold-slider-lift relative h-full w-full overflow-hidden rounded-full">
          <div
            data-tone={tone}
            data-peak={peak ? "" : undefined}
            className="hold-slider-fill absolute overflow-hidden rounded-full"
            style={{
              left: FILL_INSET_PX,
              top: FILL_INSET_PX,
              bottom: FILL_INSET_PX,
              width: fillWidth,
            }}
          >
            {/* ONE gradient across the whole track, revealed by the fill's
                width — see rampGradient. Sized to the track and pinned at the
                fill's origin, so it never stretches or re-hues as the fill
                grows: the pixels already painted stay exactly where they were
                and new ramp simply appears. */}
            <span
              data-hold-slider-ramp=""
              className="hold-slider-ramp absolute inset-y-0 left-0 block"
              style={{
                width: rampWidth,
                backgroundImage: rampGradient(detents, centers, rampWidth),
              }}
            />
            {/* The starfield — drifting specks inside the fill only, which is
                where the reference control puts them. Pure CSS radial
                gradients on a repeating tile: no image, no canvas, nothing
                for the CSP to allow, and it costs one compositor-driven
                background-position animation. */}
            <span
              data-hold-slider-stars=""
              className="hold-slider-stars absolute inset-0 block"
            />
            {/* Top stop only: the violet surge sweeps the fill, so arriving at
                Max is an EVENT and not merely a wider bar. */}
            {peak && (
              <span
                data-hold-slider-surge=""
                className="hold-slider-surge absolute inset-0 block"
              />
            )}
          </div>
          {centers.map((x, i) => {
            const reached =
              i <= dragIndex
                ? "bg-[color-mix(in_srgb,var(--void-2)_55%,transparent)]"
                : "bg-[color-mix(in_srgb,var(--silver)_45%,transparent)]";
            // Bars rise with the detent's ladder position — position, not the
            // tone's identity, deliberately: the SHAPE says "higher", the fill
            // color still says which tier (the DepthGlyph split of duties).
            // Reached BARS stay visible inside the fill (a meter is made of
            // its filled bars); reached DOTS go transparent instead — dark
            // dots swimming in the fill read as sediment, and the fill edge
            // already marks the position. They stay in the DOM so the detent
            // hooks the suites (and this file's geometry) rely on never
            // depend on the drag position.
            return marker === "bar" ? (
              <span
                key={detents[i]!.id}
                data-detent-bar={detents[i]!.id}
                className={`pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${reached}`}
                style={{
                  left: x,
                  width: BAR_W_PX,
                  height:
                    BAR_MIN_PX +
                    ((BAR_MAX_PX - BAR_MIN_PX) * i) / Math.max(centers.length - 1, 1),
                }}
              />
            ) : (
              <span
                key={detents[i]!.id}
                data-detent-dot={detents[i]!.id}
                className={`pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                  i <= dragIndex ? "opacity-0" : ""
                } ${reached}`}
                style={{ left: x, width: DOT_R * 2, height: DOT_R * 2 }}
              />
            );
          })}
          {/* The thumb (owner reference recording): a round object travelling
              the detents, easing between them with the fill's own snap.
              Painted above the markers, glass ground + hair ring, tone-cored
              through the same ramp — no text, ever (the chip above is the
              readout). */}
          <span
            data-hold-slider-thumb=""
            className="hold-slider-thumb glass-solid pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: centers[dragIndex], width: THUMB_PX, height: THUMB_PX }}
          >
            <span
              data-tone={tone}
              className="hold-slider-core absolute inset-1 rounded-full"
              style={{ backgroundColor: TONE_COLOR[tone] }}
            />
          </span>
          {/* The arrival burst — a dotted ring blooming off the thumb the
              moment the top stop is reached. `key` on the peak flag so it
              REPLAYS on every arrival rather than animating once and sitting
              spent for the rest of the gesture. */}
          {peak && (
            <BurstRing key={`burst-${dragIndex}`} x={centers[dragIndex]!} />
          )}
        </div>
        {peak && peakCaption && (
          <p className="pointer-events-none absolute -bottom-10 left-1/2 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 justify-center">
            {/* On a chip of its own, like the level readout above. As bare
                text it was legible only because the old backdrop washed the
                whole viewport flat; over a LOCAL halo it landed directly on
                the coach line beneath the rail and the two sentences
                interleaved (seen in capture, 2026-08-11). The chip is a
                separate node from the caption because `.hold-slider-caption`
                owns `background-image` and `background-clip: text` for its
                shimmer — putting glass on the same element would clip the
                pane to the glyphs. */}
            <span className="glass-solid hold-slider-lift max-w-full rounded-full px-3 py-1">
              <span
                data-hold-slider-caption=""
                className="hold-slider-caption font-body block max-w-full truncate text-center text-xs font-medium"
              >
                {peakCaption}
              </span>
            </span>
          </p>
        )}
      </div>
    </>,
    document.body,
  );
}

/** Ring diameter at rest; the animation scales it out from the thumb. */
const BURST_PX = 44;

/**
 * The dotted arrival ring. An SVG circle with a round-capped dash pattern
 * draws discrete dots rather than a solid halo — the reference control's
 * shape, and it stays crisp at any scale where a box-shadow ring would blur.
 * Purely decorative and pointer-inert; both stand-downs remove it entirely
 * (globals.css), so nothing here is load-bearing.
 */
function BurstRing({ x }: { x: number }) {
  return (
    <svg
      aria-hidden="true"
      data-hold-slider-burst=""
      viewBox="0 0 44 44"
      className="hold-slider-burst pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ left: x, width: BURST_PX, height: BURST_PX }}
    >
      <circle
        cx="22"
        cy="22"
        r="18"
        fill="none"
        stroke="var(--ultra-ink)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="0.5 8"
      />
    </svg>
  );
}

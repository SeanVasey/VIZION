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
 * Resting affordance for the slider — three slim vertical ticks at the pill's
 * trailing edge: the app's grip/detent vocabulary (the Sheet's grab rail is
 * the same slim rounded bar), NOT dots, which at this size read as a text
 * ellipsis, and NOT a chevron, which promises a dropdown the control does not
 * have (owner direction, 2026-08-11 — "I would prefer they not appear as
 * dropdowns unless they actually utilize one"). Static, aria-hidden
 * decoration: the pill label stays the readout, and the hosts render it only
 * while their slider is actually enabled — a hint that outlived its gesture
 * would be a lie.
 */
export function HoldSliderHint() {
  return (
    <span
      aria-hidden="true"
      data-hold-hint=""
      className="inline-flex shrink-0 items-center gap-[3px]"
    >
      <span className="h-[7px] w-[2px] rounded-full bg-[color-mix(in_srgb,var(--silver)_45%,transparent)]" />
      <span className="h-[9px] w-[2px] rounded-full bg-[color-mix(in_srgb,var(--silver)_55%,transparent)]" />
      <span className="h-[11px] w-[2px] rounded-full bg-[color-mix(in_srgb,var(--silver)_45%,transparent)]" />
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
  latchOnTap = false,
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
  peakCaption,
  latched,
}: {
  detents: readonly Detent[];
  active: HoldActive;
  marker: DetentMarker;
  dynamicBackdrop: boolean;
  peakCaption: string | null;
  latched: {
    scrubTo: (clientX: number) => void;
    commit: () => void;
    dismiss: () => void;
  };
}) {
  const { dragIndex, geometry, phase } = active;
  const isLatched = phase === "latched";
  const scrubbing = useRef(false);

  const onTrackPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!isLatched) return;
      // The capsule is a body portal, but React still bubbles its events up
      // the COMPONENT tree into the wrapper's own pointer handlers — where
      // they would be logged as a refused competing press. Stopping here is
      // the local fix; the wrapper's admission guard stays exactly as it is
      // for the portalled SHEETS it was written for.
      e.stopPropagation();
      scrubbing.current = true;
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
      if (!isLatched || !scrubbing.current) return;
      e.stopPropagation();
      latched.scrubTo(e.clientX);
    },
    [isLatched, latched],
  );

  const onTrackPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isLatched) return;
      e.stopPropagation();
      scrubbing.current = false;
      latched.commit();
    },
    [isLatched, latched],
  );

  if (typeof document === "undefined") return null;
  const detent = detents[dragIndex];
  if (!detent) return null;
  const tone = detent.tone;
  const peak = dragIndex === detents.length - 1;
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

          pointer-events AUTO, deliberately: the pair doubles as the
          gesture's input shield. A second pointer mid-DRAG otherwise reaches
          whatever it lands on — on hybrid-input devices its synthesized
          click opened a picker sheet under the live capsule. The gesture's
          own pointer is captured at activation (implicitly for touch), and
          captured streams bypass hit-testing, so the shield can never steal
          the drag it guards. In the LATCHED phase the same surface earns a
          second job: it is the outside-tap DISMISS target, which is the
          only reason a latched capsule is escapable by pointer at all. */}
      {!dynamicBackdrop && (
        <div
          aria-hidden="true"
          data-hold-slider-blur=""
          className="hold-slider-blur pointer-events-auto fixed inset-0 z-[84]"
        />
      )}
      <div
        aria-hidden="true"
        data-hold-slider-scrim=""
        className="hold-slider-scrim pointer-events-auto fixed inset-0 z-[84]"
        style={{
          backgroundColor: "color-mix(in srgb, var(--void) 62%, transparent)",
        }}
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
          // Latched scrubbing is a drag on the track itself; without this the
          // UA reads it as a pan and steals the pointer mid-scrub.
          touchAction: isLatched ? "none" : undefined,
        }}
        onPointerDown={onTrackPointerDown}
        onPointerMove={onTrackPointerMove}
        onPointerUp={onTrackPointerUp}
        onPointerCancel={onTrackPointerUp}
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
            className={`glass-solid font-body max-w-full truncate rounded-full px-3 py-1 text-sm font-medium ${LABEL_CLASS[tone]}`}
          >
            {detent.label}
          </span>
        </p>
        <div className="glass-solid relative h-full w-full overflow-hidden rounded-full border border-hair">
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
          <p className="pointer-events-none absolute -bottom-8 left-1/2 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 justify-center">
            <span
              data-hold-slider-caption=""
              className="hold-slider-caption font-body max-w-full truncate text-center text-xs font-medium"
            >
              {peakCaption}
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

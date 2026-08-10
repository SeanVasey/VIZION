"use client";

import { useCallback, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useHoldDrag, type TrackGeometry } from "@/components/ui/use-hold-drag";

/**
 * The hold-slider control class (docs/decisions/0012-hold-slider.md).
 *
 * `HoldSliderTrigger` wraps an existing tap-to-open trigger pill and adds the
 * press-and-hold → drag accelerator on top of it, without touching the pill's
 * own props (the composer pickers are memoized — PERF-006 — and their class
 * strings are a tested matched pair). A tap behaves exactly as before; a hold
 * — or a sideways slide in the same unbroken press — expands the overlay
 * track and the gesture drags between detents; release commits, Escape/cancel
 * reverts.
 *
 * The overlay is pointer-transparent, aria-hidden DECORATION: the pill label
 * stays the authoritative readout, the sheet stays the complete keyboard and
 * screen-reader path, and the committed value is announced through the
 * always-mounted polite live region below.
 */

/** One slider stop. `tone` keys the fill's color ramp and is the level's own
 *  identity, never its ladder position — the DepthGlyph rule, so the same id
 *  renders identically on every model's ladder. */
export interface Detent {
  id: string;
  label: string;
  tone: "faint" | "silver" | "laser" | "ultra";
}

/** Capsule fill per tone. Silver mixes read as "present but muted" against
 *  the glass track; laser/ultra are the existing fill-safe accent tokens. */
const FILL_CLASS: Record<Detent["tone"], string> = {
  faint: "bg-[color-mix(in_srgb,var(--silver)_25%,transparent)]",
  silver: "bg-[color-mix(in_srgb,var(--silver)_45%,transparent)]",
  laser: "bg-laser",
  ultra: "bg-ultra",
};

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
 *  spend. Form is the disambiguator between the two stacked sliders —
 *  never a new hue (tokens are locked, and the ramp is the level's). */
export type DetentMarker = "dot" | "bar";

/**
 * Resting affordance for the hold gesture — three detent dots at the pill's
 * trailing edge, the capsule's own vocabulary in miniature. ADR-0012 shipped
 * with the sheet as the only DISCOVERABLE path and the gesture invisible at
 * rest; the 2026-08-10 owner pass revisited that trade. Static, aria-hidden
 * decoration: the pill label stays the readout, the sheet stays the
 * accessible path, and the pickers render it only while their slider is
 * actually enabled — a hint that outlived its gesture would be a lie.
 */
export function HoldSliderHint() {
  return (
    <span
      aria-hidden="true"
      data-hold-hint=""
      className="inline-flex shrink-0 items-center gap-[3px]"
    >
      <span className="h-[3px] w-[3px] rounded-full bg-[color-mix(in_srgb,var(--silver)_45%,transparent)]" />
      <span className="h-[3px] w-[3px] rounded-full bg-[color-mix(in_srgb,var(--silver)_45%,transparent)]" />
      <span className="h-[3px] w-[3px] rounded-full bg-[color-mix(in_srgb,var(--silver)_45%,transparent)]" />
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
  children,
}: {
  detents: readonly Detent[];
  /** The committed detent (what the wrapped pill currently shows). */
  selectedIndex: number;
  /** Full announcement for a detent, e.g. "Fable 5 · Extra High". Shown
   *  above the track while dragging and announced on commit. */
  liveLabel: (detent: Detent) => string;
  /** Landed-detent index on release. Must be identity-stable. */
  onCommit: (index: number) => void;
  /** False = the wrapper is inert and claims nothing; taps are untouched. */
  enabled: boolean;
  /** Detent glyph vocabulary — see DetentMarker. */
  detentMarker?: DetentMarker;
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

  const { active, props } = useHoldDrag({
    detentCount: detents.length,
    selectedIndex,
    enabled,
    onCommit: handleCommit,
  });

  const dragDetent = active ? detents[active.dragIndex] : undefined;

  return (
    <span className="inline-flex" {...props}>
      {children}
      {/* Always mounted so the first commit's announcement is not dropped
          while the region registers (the A11Y-005 lesson). aria-live only,
          deliberately NOT role="status": the result view's tests (and the
          clarify-questions guard) query role=status SINGULAR, and a live
          announcement needs no role to be spoken. */}
      <span aria-live="polite" data-hold-slider-announce="" className="sr-only">
        {announced}
      </span>
      {active && dragDetent && (
        <HoldSliderOverlay
          detents={detents}
          dragIndex={active.dragIndex}
          geometry={active.geometry}
          label={liveLabel(dragDetent)}
          marker={detentMarker}
        />
      )}
    </span>
  );
}

/** Dot radius; the fill capsule extends this far past the active dot. */
const DOT_R = 4;
/** Inset between the track's border and the fill capsule. */
const FILL_INSET_PX = 6;
/** Bar-marker geometry: 3px ticks rising from BAR_MIN to BAR_MAX across the
 *  track, so the ladder's shape is legible inside the 48px capsule. */
const BAR_W_PX = 3;
const BAR_MIN_PX = 8;
const BAR_MAX_PX = 20;

/**
 * The expanded track — pure presentation; the suites (unit and e2e) reach it
 * through the `data-hold-slider-overlay` DOM hook, not an import. Portalled to
 * `document.body` because the composer chassis is `overflow-hidden`
 * (EnhanceComposer) and would clip a track wider than the rail; fixed
 * positioning comes from TrackGeometry, which already anchored the selected
 * detent under the finger and clamped to the viewport. `pointer-events:
 * none` keeps the capture on the wrapper — the overlay can never steal the
 * gesture it visualizes. z-[85]: above the toast tier; a Sheet (z-[70]) can
 * never be open mid-gesture — enforced, not assumed: useHoldDrag refuses a
 * pointer-down whose target is outside the wrapper's DOM subtree, and an
 * open sheet's scrim covers the pill, so no gesture can start while one is
 * up (the 2026-08-10 capsule-over-the-sheet defect).
 */
function HoldSliderOverlay({
  detents,
  dragIndex,
  geometry,
  label,
  marker,
}: {
  detents: readonly Detent[];
  dragIndex: number;
  geometry: TrackGeometry;
  label: string;
  marker: DetentMarker;
}) {
  if (typeof document === "undefined") return null;
  const tone = detents[dragIndex]?.tone ?? "silver";
  // Offsets inside the track, from viewport-x detent centers.
  const centers = geometry.detentCenters.map((x) => x - geometry.left);
  const fillWidth = centers[dragIndex]! + DOT_R + 2 - FILL_INSET_PX;

  return createPortal(
    <div
      aria-hidden="true"
      data-hold-slider-overlay=""
      className="pointer-events-none fixed z-[85]"
      style={{
        left: geometry.left,
        top: geometry.top,
        width: geometry.width,
        height: geometry.height,
      }}
    >
      <p
        className={`font-body absolute inset-x-0 -top-8 truncate text-center text-sm font-medium ${LABEL_CLASS[tone]}`}
      >
        {label}
      </p>
      <div className="glass-solid relative h-full w-full overflow-hidden rounded-full border border-hair">
        <div
          data-tone={tone}
          className={`hold-slider-fill absolute rounded-full ${FILL_CLASS[tone]}`}
          style={{
            left: FILL_INSET_PX,
            top: FILL_INSET_PX,
            bottom: FILL_INSET_PX,
            width: Math.max(fillWidth, geometry.height - FILL_INSET_PX * 2),
          }}
        />
        {centers.map((x, i) => {
          const reached =
            i <= dragIndex
              ? "bg-[color-mix(in_srgb,var(--void-2)_55%,transparent)]"
              : "bg-[color-mix(in_srgb,var(--silver)_45%,transparent)]";
          // Bars rise with the detent's ladder position — position, not the
          // tone's identity, deliberately: the SHAPE says "higher", the fill
          // color still says which tier (the DepthGlyph split of duties).
          return marker === "bar" ? (
            <span
              key={detents[i]!.id}
              data-detent-bar={detents[i]!.id}
              className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${reached}`}
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
              className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${reached}`}
              style={{ left: x, width: DOT_R * 2, height: DOT_R * 2 }}
            />
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

"use client";

import { memo, useRef, useState } from "react";
import { MODES, type ModeId } from "@/lib/constants";
import { MODE_BLURB } from "@/lib/enhance/modes";

/**
 * Mode instrument (remediation R5.1).  ONE glass chassis with six equal cells
 * (grid repeat(6,1fr)), icon-over-label, and a sliding Laser "lens-lock"
 * indicator behind the active cell — the same aperture motion as the brand
 * mark.  Active cell text/icon = --on-laser; inactive cell ICONS carry the
 * brand green via --accent-ink (Laser on dark, deep green on light — never raw
 * laser as a stroke on a light surface, §6) while their labels stay Silver.
 * Cell labels and the help-strip blurbs use `.cap-trim` so their glyphs — not
 * the font's ascent/descent headroom — are what gets vertically centered in
 * each pill.  Symmetric at 360/390/430px.
 *
 * A one-line helper sits IN FLOW below the rig (above the composer): plain
 * secondary text showing one mode description — the hovered/focused cell,
 * falling back to the active mode. (The 2026-07 UX audit demoted the old
 * onyx card + caret: the explanation is guidance, not a surface, and must
 * not cost a full card of vertical space.)  That ruling still stands and is
 * why the helper carries `.ambient-scrim` rather than a glass tier: the
 * scrim is a FILL only — no hairline, no sheen, no blur — added because
 * this is the one caption with nothing between it and the ambient layer,
 * where a drifting bloom spends most of the light-theme Silver contrast
 * margin. A glass tier here would have re-created exactly the card the
 * audit removed; a wash costs no card and no caret.  All six blurbs stay
 * stacked in one grid cell, so the line is sized by the longest description
 * and never shifts layout as the described mode changes.
 */
export const ModeRig = memo(function ModeRig({
  activeMode,
  onSelect,
}: {
  activeMode: ModeId;
  onSelect: (id: ModeId) => void;
}) {
  const activeIndex = Math.max(
    0,
    MODES.findIndex((m) => m.id === activeMode),
  );
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /** Transient hover/focus preview; the helper falls back to the active mode. */
  const [previewMode, setPreviewMode] = useState<ModeId | null>(null);
  const shownMode = previewMode ?? activeMode;

  return (
    <div className="flex flex-col gap-2">
      {/* A radiogroup, not a tablist: this is a pick-one control with no panels,
          and radios carry the arrow-key + roving-tabindex contract implemented
          below (WCAG AA — previously the roles promised keys that did nothing). */}
      <div
        role="radiogroup"
        aria-label="Enhancement mode"
        // Grid columns derive from MODES.length, not a hardcoded 6 (DSN-006):
        // a seventh mode reflows the chassis instead of overflowing it. The
        // keyboard nav already used MODES.length; this closes the last two
        // literals (grid + indicator width).
        style={{ gridTemplateColumns: `repeat(${MODES.length}, minmax(0, 1fr))` }}
        className="glass relative grid gap-0 rounded-2xl p-1"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setPreviewMode(null);
            return;
          }
          const last = MODES.length - 1;
          let next: number;
          switch (e.key) {
            case "ArrowRight":
            case "ArrowDown":
              next = activeIndex === last ? 0 : activeIndex + 1;
              break;
            case "ArrowLeft":
            case "ArrowUp":
              next = activeIndex === 0 ? last : activeIndex - 1;
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
          onSelect(MODES[next]!.id);
          cellRefs.current[next]?.focus();
        }}
      >
        {/* Sliding lens-lock indicator — one sixth wide, translates to the cell. */}
        <span
          aria-hidden="true"
          className="selected-ink pointer-events-none absolute inset-y-1 left-1 rounded-xl bg-laser transition-transform [transition-duration:var(--motion-slide)] [transition-timing-function:var(--ease-out)]"
          style={{
            width: `calc((100% - 0.5rem) / ${MODES.length})`,
            transform: `translateX(calc(${activeIndex} * 100%))`,
          }}
        />
        {MODES.map((mode, i) => {
          const active = activeMode === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              ref={(el) => {
                cellRefs.current[i] = el;
              }}
              aria-describedby={shownMode === mode.id ? "mode-help-strip" : undefined}
              onClick={() => onSelect(mode.id)}
              onMouseEnter={() => setPreviewMode(mode.id)}
              onMouseLeave={() => setPreviewMode(null)}
              onFocus={() => setPreviewMode(mode.id)}
              onBlur={() => setPreviewMode(null)}
              className={[
                "font-body relative z-10 flex min-h-[56px] flex-col items-center justify-center gap-1 overflow-hidden rounded-xl px-1 py-2 text-[0.6875rem] font-medium transition-colors max-[359px]:text-[0.625rem] max-[359px]:tracking-tight",
                active ? "text-on-laser" : "text-silver hover:text-chalk",
              ].join(" ")}
            >
              {/* Inactive icons take the theme-aware green; the active icon
                  inherits the cell's --on-laser so it stays legible on the
                  Laser lens-lock fill. */}
              <ModeIcon id={mode.id} className={active ? undefined : "text-accent"} />
              {/* The sub-360 tracking must live HERE, not only on the button:
                  this span's own tracking-wide beats an inherited value, so
                  the cell-level max-[359px]:tracking-tight never reached the
                  label and Condense/Reformat overflowed their cells at 320. */}
              <span className="cap-trim leading-none tracking-wide max-[359px]:tracking-tight">
                {mode.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Mode helper — concise secondary text, still not a card, but scrimmed:
          this is the one on-screen caption sitting directly on the ambient
          layer, and a bloom passing behind --silver text spends most of that
          pair's contrast headroom, thin enough that an overlapping bloom or
          the particle canvas's glow could take it below AA. `.ambient-scrim`
          is a fill and nothing else — a glass tier here would give a one-line
          caption a hairline and a sheen and make it read heavier than the
          mode rail it describes. The stacked blurbs share one grid cell: the
          tallest reserves the height (the scrim's padding is constant
          regardless of which mode is shown, so it doesn't reintroduce a
          layout shift on switch), the shown one cross-fades in. No aria-live:
          hover-driven changes would chatter; aria-describedby on the shown
          cell carries the association instead. */}
      <div
        id="mode-help-strip"
        className="ambient-scrim grid items-start rounded-xl px-3 py-1.5 text-center"
      >
        {MODES.map((mode) => {
          const shown = mode.id === shownMode;
          return (
            <p
              key={mode.id}
              aria-hidden={!shown}
              className={[
                "font-body col-start-1 row-start-1 text-balance text-xs leading-snug text-silver transition-opacity duration-150",
                shown ? "opacity-100" : "opacity-0",
              ].join(" ")}
            >
              {MODE_BLURB[mode.id]}
            </p>
          );
        })}
      </div>
    </div>
  );
});

/** 1.5px-stroke, rounded-join icons on a 24px grid (style-guide §1.4). */
function ModeIcon({ id, className }: { id: ModeId; className?: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": true,
    className: ["h-5 w-5 transition-colors", className].filter(Boolean).join(" "),
  } as const;
  const stroke = {
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (id) {
    case "clarify": // aperture / focus
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6" {...stroke} />
          <path d="m20 20-3.5-3.5" {...stroke} />
        </svg>
      );
    case "polish": // pencil / light correction
      return (
        <svg {...common}>
          <path d="M4 20h4L18 10l-4-4L4 16v4z" {...stroke} />
          <path d="m13 7 4 4" {...stroke} />
        </svg>
      );
    case "expand": // corner brackets, outward
      return (
        <svg {...common}>
          <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" {...stroke} />
        </svg>
      );
    case "condense": // corner brackets, inward — must differ from expand by
      // GEOMETRY (elbows on the inner box, legs reaching the frame): flipping
      // only a path's draw direction renders an identical glyph.
      return (
        <svg {...common}>
          <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" {...stroke} />
        </svg>
      );
    case "reformat": // structured lines
      return (
        <svg {...common}>
          <path d="M4 6h16M4 12h10M4 18h13" {...stroke} />
        </svg>
      );
    case "target": // concentric target
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7" {...stroke} />
          <circle cx="12" cy="12" r="2.5" {...stroke} />
        </svg>
      );
  }
}

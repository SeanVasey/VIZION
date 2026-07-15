"use client";

import { memo, useEffect, useRef, useState } from "react";
import { MODES, type ModeId } from "@/lib/constants";
import { MODE_BLURB } from "@/lib/enhance/modes";

/**
 * Mode instrument (remediation R5.1).  ONE glass chassis with six equal cells
 * (grid repeat(6,1fr)), icon-over-label, and a sliding Laser "lens-lock"
 * indicator behind the active cell — the same aperture motion as the brand
 * mark.  Active cell text/icon = --on-laser.  Symmetric at 360/390/430px.
 *
 * A single shared help pill sits below the rig: it appears on hover/focus of a
 * cell (and briefly on tap-selection for touch), its caret tracking the cell
 * with the same sixth-width math as the lens-lock. Escape/leave/blur hides it.
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

  const [helpFor, setHelpFor] = useState<ModeId | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimer = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };
  useEffect(() => clearHideTimer, []);

  const showHelp = (id: ModeId) => {
    clearHideTimer();
    setHelpFor(id);
  };
  const hideHelp = () => {
    clearHideTimer();
    setHelpFor(null);
  };
  /** Tap/click: no hover to end the pill, so it hides itself after a beat. */
  const flashHelp = (id: ModeId) => {
    showHelp(id);
    hideTimer.current = setTimeout(() => setHelpFor(null), 2500);
  };

  const helpIndex = helpFor
    ? Math.max(
        0,
        MODES.findIndex((m) => m.id === helpFor),
      )
    : 0;

  return (
    // A radiogroup, not a tablist: this is a pick-one control with no panels,
    // and radios carry the arrow-key + roving-tabindex contract implemented
    // below (WCAG AA — previously the roles promised keys that did nothing).
    <div
      role="radiogroup"
      aria-label="Enhancement mode"
      className="glass relative grid grid-cols-6 gap-0 rounded-2xl p-1"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          hideHelp();
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
        className="pointer-events-none absolute inset-y-1 left-1 rounded-xl bg-laser transition-transform duration-300 ease-out"
        style={{
          width: "calc((100% - 0.5rem) / 6)",
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
            aria-describedby={helpFor === mode.id ? "mode-help-pill" : undefined}
            onClick={() => {
              onSelect(mode.id);
              flashHelp(mode.id);
            }}
            onMouseEnter={() => showHelp(mode.id)}
            onMouseLeave={hideHelp}
            onFocus={() => showHelp(mode.id)}
            onBlur={hideHelp}
            className={[
              "font-body relative z-10 flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[0.6875rem] font-medium transition-colors",
              active ? "text-on-laser" : "text-silver hover:text-chalk",
            ].join(" ")}
          >
            <ModeIcon id={mode.id} />
            <span className="tracking-wide">{mode.label}</span>
          </button>
        );
      })}
      {/* Shared help pill — one floating description ABOVE the rig, its caret
          aligned to the described cell (same sixth-width math as the lens-lock).
          It must sit above, not below: the composer beneath is a .glass surface
          whose backdrop-filter forms its own stacking context and paints over a
          sibling's children regardless of their z-index — below the rig the
          pill is obscured (seen on mobile). The fill is OPAQUE --onyx, not
          .glass: a translucent pill over the guidance strip blends both texts
          into an unreadable smear — the pill must cleanly cover what's behind
          it. pointer-events-none keeps it inert. */}
      {helpFor !== null && (
        <div
          id="mode-help-pill"
          role="tooltip"
          className="pill tooltip-in pointer-events-none absolute inset-x-1 bottom-full z-30 mb-2 border border-hair bg-onyx px-4 py-2 text-center text-xs text-chalk"
        >
          <span
            aria-hidden="true"
            className="absolute -bottom-1 h-2 w-2 rotate-45 border-b border-r border-hair bg-onyx"
            style={{
              left: `calc(${helpIndex + 0.5} * (100% / 6))`,
              marginLeft: "-4px",
            }}
          />
          {MODE_BLURB[helpFor]}
        </div>
      )}
    </div>
  );
});

/** 1.5px-stroke, rounded-join icons on a 24px grid (style-guide §1.4). */
function ModeIcon({ id }: { id: ModeId }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": true,
    className: "h-5 w-5",
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
    case "expand": // arrows out
      return (
        <svg {...common}>
          <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" {...stroke} />
        </svg>
      );
    case "condense": // arrows in
      return (
        <svg {...common}>
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" {...stroke} />
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

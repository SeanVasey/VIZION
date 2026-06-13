"use client";

import { memo } from "react";
import { MODES, type ModeId } from "@/lib/constants";

/**
 * Mode instrument (remediation R5.1).  ONE glass chassis with five equal cells
 * (grid repeat(5,1fr)), icon-over-label, and a sliding Laser "lens-lock"
 * indicator behind the active cell — the same aperture motion as the brand
 * mark.  Active cell text/icon = --on-laser.  Symmetric at 360/390/430px.
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

  return (
    <div
      role="tablist"
      aria-label="Enhancement mode"
      className="glass relative grid grid-cols-5 gap-0 rounded-2xl p-1"
    >
      {/* Sliding lens-lock indicator — one fifth wide, translates to the cell. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-1 left-1 rounded-xl bg-laser transition-transform duration-300 ease-out"
        style={{
          width: "calc((100% - 0.5rem) / 5)",
          transform: `translateX(calc(${activeIndex} * 100%))`,
        }}
      />
      {MODES.map((mode) => {
        const active = activeMode === mode.id;
        return (
          <button
            key={mode.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(mode.id)}
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

import type { ReactNode } from "react";

/**
 * The inline SVG glyph language (INV-06: zero emoji codepoints in UI).
 *
 * Emoji-range dingbats (✓ ★ ✕ ✎ ⚠ ✦) render as platform-colored type at a
 * platform-chosen weight — these glyphs sit on the 24px icon grid, inherit
 * `currentColor`, and default to a `1em` box so they scale with the text they
 * annotate; call sites size them explicitly where they stand alone. Every
 * glyph is decorative (`aria-hidden`): each site carries its own text or
 * aria-label, so nothing is conveyed by the mark alone.
 */
function Glyph({
  className,
  filled = false,
  children,
}: {
  className?: string;
  /** State markers (favorite star, spark) are filled like the developer
   *  marks; action/status glyphs stay 1.5px strokes like CheckGlyph. */
  filled?: boolean;
  children: ReactNode;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 1 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "inline-block h-[1em] w-[1em] shrink-0"}
    >
      {children}
    </svg>
  );
}

/** Trailing confirmation mark — the "Copied", "Saved", "In prompt" sites.
 *  Same stroke geometry as ui/CheckGlyph, sized to ride inline with text. */
export function CheckMark({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M5 12.5l4.5 4.5L19 7.5" strokeWidth={2} />
    </Glyph>
  );
}

/** Favorite star — filled, because it marks the ON state. */
export function StarMark({ className }: { className?: string }) {
  return (
    <Glyph className={className} filled>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </Glyph>
  );
}

/** Dismiss / delete cross. */
export function XMark({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Glyph>
  );
}

/** Rename pencil. */
export function PencilMark({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </Glyph>
  );
}

/** Remove-from-collection: the FolderMark silhouette with a minus (audit
 *  VAR-10 — replaces the U+232B text glyph, which rendered as platform type
 *  outside the SVG glyph language). */
export function FolderMinusMark({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <path d="M9 13.5h6" />
    </Glyph>
  );
}

/** Paste from clipboard (audit VAR-10 — replaces the U+2338 text glyph). */
export function ClipboardMark({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <rect x="5.5" y="4.5" width="13" height="16" rx="2" />
      <path d="M9.5 4.5V4A1.5 1.5 0 0 1 11 2.5h2A1.5 1.5 0 0 1 14.5 4v.5" />
    </Glyph>
  );
}

/** Cap-warning triangle. */
export function WarningMark({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Glyph>
  );
}

/** Template card — a framed layout with a title row, for "Try a template".
 *  Deliberately NOT the four-point spark that replaced the old ✦: that
 *  concave-star silhouette is the Gemini developer mark (DeveloperIcon
 *  `google`), and an app whose Target rail renders developer marks cannot
 *  spend one of those identities on an unrelated affordance. Stroke, not
 *  filled: this is an action affordance, not a state marker. */
export function TemplateMark({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <rect x="4" y="3.5" width="16" height="17" rx="2.5" />
      <path d="M4 9h16" />
      <path d="M8.5 13.5h7" />
      <path d="M8.5 17h4.5" />
    </Glyph>
  );
}

/** Archive box (replaces the ▤ dingbat in the same menu). */
export function ArchiveMark({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M21 8v13H3V8" />
      <path d="M1 3h22v5H1z" />
      <path d="M10 12h4" />
    </Glyph>
  );
}

/** Restore arrow (the trash sheet's headline action). */
export function UndoGlyph({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M4 7h9a6 6 0 0 1 0 12h-3" />
      <path d="M8 3.5 4 7l4 3.5" />
    </Glyph>
  );
}

/** Collection folder (replaces the ⌂ dingbat in the same menu). */
export function FolderMark({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </Glyph>
  );
}

/** Sun — the LIGHT theme, categorically. The theme marks name the STORED
 *  setting, never the resolved appearance: under "system" the machine mark
 *  shows even when the OS resolves dark, which is exactly what separates a
 *  deliberate dark choice from an inherited one (the rotated half-circle
 *  glyphs these replace could not make that distinction legible). */
export function SunMark({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5" />
      <path d="M12 19v2.5" />
      <path d="M2.5 12H5" />
      <path d="M19 12h2.5" />
      <path d="M5.3 5.3l1.8 1.8" />
      <path d="M16.9 16.9l1.8 1.8" />
      <path d="M18.7 5.3l-1.8 1.8" />
      <path d="M7.1 16.9l-1.8 1.8" />
    </Glyph>
  );
}

/** Crescent moon — the DARK theme. */
export function MoonMark({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M20.4 14.2A8.5 8.5 0 1 1 9.8 3.6a7 7 0 0 0 10.6 10.6z" />
    </Glyph>
  );
}

/** Monitor — the SYSTEM theme (follow the machine's own setting). */
export function SystemMark({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <rect x="3" y="4.5" width="18" height="13" rx="2" />
      <path d="M9 21h6" />
      <path d="M12 17.5V21" />
    </Glyph>
  );
}

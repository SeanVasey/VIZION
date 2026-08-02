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

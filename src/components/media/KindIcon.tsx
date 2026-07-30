import type { MediaKind } from "@/lib/media/types";

/**
 * Media-kind glyph for attachment/stored-media rows — 1.5px-stroke, rounded
 * joins on the 24px grid (style-guide §1.4), replacing the raw emoji that
 * used to sit here. Emoji render in platform colour with per-OS baselines,
 * which broke the monochrome icon language everywhere these rows appear next
 * to stroked SVGs. Decorative: callers keep aria-hidden on the container.
 */
export function KindIcon({
  kind,
  className = "h-5 w-5",
}: {
  kind: MediaKind;
  className?: string;
}) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": true,
    className,
  } as const;
  const stroke = {
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (kind) {
    case "image":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="14" rx="2" {...stroke} />
          <circle cx="9" cy="10" r="1.5" {...stroke} />
          <path d="m5 17.5 4.5-4.5 3 3 2.5-2.5 4 4" {...stroke} />
        </svg>
      );
    case "video":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="14" rx="2" {...stroke} />
          <path d="M8 5v14M16 5v14M4 9.5h4M4 14.5h4M16 9.5h4M16 14.5h4" {...stroke} />
        </svg>
      );
    case "audio":
      return (
        <svg {...common}>
          <path d="M4 15v-3a8 8 0 0 1 16 0v3" {...stroke} />
          <rect x="4" y="14" width="4" height="5" rx="1.5" {...stroke} />
          <rect x="16" y="14" width="4" height="5" rx="1.5" {...stroke} />
        </svg>
      );
  }
}

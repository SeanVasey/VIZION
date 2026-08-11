/**
 * The VIZION brand mark — the chevron framing a bar and split ring.
 *
 * Inline, single monochrome path drawn with `currentColor`, following the
 * DeveloperIcon convention: the parent's text colour governs, so pair with
 * `text-accent` (the theme-aware `--accent-ink`: Laser in dark, deep green on
 * light) to keep the mark AA-legible in both themes. Never hardcode a fill.
 *
 * The geometry is the master `public/brand/vizion-glyph.svg` verbatim — the
 * same path the icon derivatives are composed from
 * (scripts/generate-icons.mjs), so the mark in the app and the mark on the
 * home screen are one shape. It is INLINED rather than fetched because the
 * master paints a flat #000000 and an <img> cannot be recoloured per theme,
 * while the Icon Composer foreground layers bake in the icon's 0.74 padding,
 * which would have to be subtracted back out of the layout.
 *
 * tests/unit/brand-mark.test.ts asserts this path and viewBox still equal the
 * master, so a re-cut of the artwork fails the gate instead of silently
 * leaving the in-app mark behind.
 */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 892.8" fill="none" aria-hidden="true" className={className}>
      <path
        d="M 589.98,130.37 L 589.15,215.36 L 619.68,229.39 L 643.61,244.24 L 658.46,255.79 L 679.09,275.60 L 694.77,294.58 L 704.67,309.43 L 717.87,334.18 L 729.42,367.19 L 733.55,391.12 L 734.38,391.94 L 738.50,386.99 L 741.80,391.12 L 803.69,317.68 L 803.69,314.38 L 797.91,299.53 L 781.41,267.35 L 764.91,242.59 L 745.10,218.66 L 723.65,197.21 L 695.59,174.93 L 670.84,159.25 L 638.66,143.57 L 610.60,133.67 L 598.23,130.37 Z M 434.02,130.37 L 425.77,130.37 L 413.40,133.67 L 385.34,143.57 L 353.16,159.25 L 328.41,174.93 L 300.35,197.21 L 278.90,218.66 L 259.09,242.59 L 242.59,267.35 L 226.09,299.53 L 220.31,314.38 L 220.31,317.68 L 282.20,391.12 L 283.85,390.29 L 284.67,386.99 L 289.62,391.94 L 290.45,391.12 L 294.58,367.19 L 306.13,334.18 L 319.33,309.43 L 329.23,294.58 L 344.91,275.60 L 365.54,255.79 L 380.39,244.24 L 404.32,229.39 L 434.85,215.36 Z M 19.80,127.90 L 69.31,216.19 L 129.55,319.33 L 270.65,552.84 L 332.53,643.61 L 388.64,721.17 L 450.53,802.04 L 509.94,873.00 L 514.06,873.00 L 573.47,802.04 L 610.60,754.18 L 691.47,643.61 L 753.35,552.84 L 862.27,373.79 L 935.71,249.19 L 1004.20,128.72 L 1003.37,127.90 L 994.29,137.80 L 993.47,135.32 L 997.60,128.72 L 996.77,127.90 L 986.87,137.80 L 846.59,296.23 L 712.10,454.65 L 521.49,687.34 L 511.59,697.24 L 311.90,454.65 L 177.41,296.23 L 37.13,137.80 L 27.23,127.90 L 26.40,128.72 L 30.53,135.32 L 29.71,137.80 Z M 507.46,19.80 L 453.83,70.14 L 453.83,583.37 L 508.29,651.04 L 512.41,647.74 L 515.71,651.04 L 570.17,583.37 L 570.17,70.14 L 516.54,19.80 L 513.24,21.45 Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}

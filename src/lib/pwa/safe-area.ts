/**
 * Safe-area v2 — luminance-polarity template.
 *
 * The recurring iOS notch / home-indicator problem is that the status-bar tint
 * and nav contrast must resolve correctly against whatever surface sits behind
 * them — Void in dark theme, Chalk in light theme — without per-app hand-tuning.
 *
 * This module is the generic, suite-reusable piece: given a surface color it
 * computes relative luminance (WCAG 2.1) and derives the correct *polarity*
 * (whether content on that surface should be light or dark, and which
 * status-bar style iOS should use).  Components consume `resolvePolarity` and
 * apply the returned tokens; nothing here touches the DOM, so it is unit-testable
 * in isolation.
 */

export type Polarity = "light-on-dark" | "dark-on-light";

/** iOS `apple-mobile-web-app-status-bar-style` values we choose between. */
export type StatusBarStyle = "black-translucent" | "default";

export interface SafeAreaPolarity {
  /** Relative luminance of the surface, 0 (black) – 1 (white). */
  luminance: number;
  /** Whether the surface is "dark" (luminance below the 0.5 midpoint). */
  isDark: boolean;
  /** Content polarity to use on top of this surface. */
  polarity: Polarity;
  /** Foreground token to paint text/icons with on this surface. */
  foreground: "chalk" | "void";
  /** iOS standalone status-bar style for this surface. */
  statusBarStyle: StatusBarStyle;
}

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Parse a #rgb / #rrggbb string into 0–255 channels. */
export function parseHex(hex: string): { r: number; g: number; b: number } {
  const match = hex.trim().match(HEX_RE);
  if (!match?.[1]) {
    throw new Error(`safe-area: invalid hex color "${hex}"`);
  }
  let body = match[1];
  if (body.length === 3) {
    body = body
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
  };
}

/** Linearize a single 0–255 sRGB channel per WCAG 2.1. */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2.1 relative luminance of a hex color, 0–1. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG contrast ratio between two hex colors (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Resolve the safe-area polarity for a given surface color.
 * The 0.5 luminance midpoint is the generic dark/light decision boundary; it
 * cleanly separates Void (~0.006) from Chalk (~0.89).
 */
export function resolvePolarity(surfaceHex: string): SafeAreaPolarity {
  const luminance = relativeLuminance(surfaceHex);
  const isDark = luminance < 0.5;
  return {
    luminance,
    isDark,
    polarity: isDark ? "light-on-dark" : "dark-on-light",
    foreground: isDark ? "chalk" : "void",
    statusBarStyle: isDark ? "black-translucent" : "default",
  };
}

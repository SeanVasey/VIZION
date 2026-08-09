/**
 * Self-hosted brand typography (the three locked roles, product-spec §1.1).
 *
 * Vendored OFL woff2 (latin subset) under this folder so production builds never
 * depend on a Google Fonts network fetch — see tasks/lessons.md (P1: next/font
 * needs egress at build time). The SIL Open Font License 1.1 text and per-family
 * copyright notices that must accompany these files live in ./OFL.txt. Each
 * family exposes a CSS variable that tokens.css layers in front of the system
 * fallback stack.
 *
 *   Bebas Neue   → --font-bebas        (display headings only)
 *   Reddit Sans  → --font-reddit-sans  (all UI, body, labels, input editor)
 *   JetBrains Mono → --font-jetbrains   (enhanced-prompt OUTPUT region only)
 */
import localFont from "next/font/local";

export const bebasNeue = localFont({
  src: [{ path: "./BebasNeue-Regular.woff2", weight: "400", style: "normal" }],
  variable: "--font-bebas",
  display: "swap",
});

// Vendored weights ⊆ used weights (audit VAR-06, pinned by
// tests/unit/font-weights.test.ts): RedditSans-700 was preloaded on every
// route — auth pages included — while no rule in src ever set weight 700,
// and two JetBrains weights sat vendored-inert. A weight joins this manifest
// when a consumer (font-bold / font-weight: 700) actually lands.
export const redditSans = localFont({
  src: [
    { path: "./RedditSans-400.woff2", weight: "400", style: "normal" },
    { path: "./RedditSans-500.woff2", weight: "500", style: "normal" },
    { path: "./RedditSans-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-reddit-sans",
  display: "swap",
});

export const jetBrainsMono = localFont({
  src: [{ path: "./JetBrainsMono-400.woff2", weight: "400", style: "normal" }],
  variable: "--font-jetbrains",
  display: "swap",
  // The mono family renders ONLY in the enhance/library OUTPUT regions — never
  // on /sign-in, /set-password, or /profile. Default preloading would emit a
  // <link rel=preload> per weight (~65 KB) on every route, auth pages included,
  // for glyphs they never show. preload:false loads it on demand with swap when
  // an output region first mounts (PERF-007).
  preload: false,
});

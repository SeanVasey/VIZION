/**
 * Self-hosted brand typography (the three locked roles, product-spec §1.1).
 *
 * Vendored OFL woff2 (latin subset) under this folder so production builds never
 * depend on a Google Fonts network fetch — see tasks/lessons.md (P1: next/font
 * needs egress at build time). Each family exposes a CSS variable that
 * tokens.css layers in front of the system fallback stack.
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

export const redditSans = localFont({
  src: [
    { path: "./RedditSans-400.woff2", weight: "400", style: "normal" },
    { path: "./RedditSans-500.woff2", weight: "500", style: "normal" },
    { path: "./RedditSans-600.woff2", weight: "600", style: "normal" },
    { path: "./RedditSans-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-reddit-sans",
  display: "swap",
});

export const jetBrainsMono = localFont({
  src: [
    { path: "./JetBrainsMono-400.woff2", weight: "400", style: "normal" },
    { path: "./JetBrainsMono-500.woff2", weight: "500", style: "normal" },
    { path: "./JetBrainsMono-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-jetbrains",
  display: "swap",
});

import type { Config } from "tailwindcss";

/**
 * Tokens are defined as CSS variables in src/styles/tokens.css so the dark/light
 * swap is a single attribute flip. Tailwind maps semantic names onto those vars.
 */
const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/stores/**/*.{ts,tsx}",
  ],
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      // The seven locked roles (FINAL_PLAN §2) + Amber warning.
      void: "var(--void)",
      // --void-2 / --lift remain in tokens.css (the mesh-ground gradient reads
      // them) but no `bg-void-2`/`text-lift` utility was ever consumed — the
      // dead color keys are dropped (DEAD-003).
      onyx: "var(--onyx)",
      silver: "var(--silver)",
      chalk: "var(--chalk)",
      laser: "var(--laser)",
      "on-laser": "var(--on-laser)",
      // In theme.colors (not just extend.borderColor) so bg-hair/divide-hair
      // exist — without this, `bg-hair` silently generates NO utility and the
      // hairline dividers render invisible.
      hair: "var(--hair)",
      accent: "var(--accent-ink)",
      flare: "var(--flare)",
      // Pulse and Amber follow the Laser split: the bare name is the FILL
      // (bg-pulse / bg-amber, which carry --on-laser ink at 10:1+), the -ink
      // name is the text/icon role that darkens on the light canvas. Tailwind
      // still emits `text-pulse` / `text-amber` from these keys — they are the
      // 1.83:1 and 1.41:1 failures, and nothing in the config can withdraw
      // them, so tests/unit/a11y.test.ts is what holds the line (DSN-013).
      pulse: "var(--pulse)",
      amber: "var(--amber)",
      "pulse-ink": "var(--pulse-ink)",
      "amber-ink": "var(--amber-ink)",
      // Theme-resolved semantic aliases (flip with [data-theme]).
      bg: "var(--bg)",
      surface: "var(--surface)",
      text: "var(--text)",
      muted: "var(--muted)",
    },
    fontFamily: {
      display: "var(--font-display)",
      body: "var(--font-body)",
      mono: "var(--font-mono)",
    },
    // Major Third scale, base 16 (FINAL_PLAN §2): 12·14·16·20·25·31·39.
    fontSize: {
      xs: ["0.75rem", { lineHeight: "1rem" }] /* 12 */,
      sm: ["0.875rem", { lineHeight: "1.25rem" }] /* 14 */,
      base: ["1rem", { lineHeight: "1.55rem" }] /* 16 */,
      lg: ["1.25rem", { lineHeight: "1.6rem" }] /* 20 */,
      xl: ["1.5625rem", { lineHeight: "1.7rem" }] /* 25 */,
      "2xl": ["1.9375rem", { lineHeight: "1.1" }] /* 31 */,
      "3xl": ["2.4375rem", { lineHeight: "1.05" }] /* 39 */,
    },
    extend: {
      // 4px base unit, 8-pt rhythm (per FINAL_PLAN §2). These keys are pinned to
      // the --space variable so the rhythm can be retuned in one place; they sit
      // in `extend` (not a full replacement) so Tailwind's complete spacing scale
      // — e.g. h-9 / h-11 / h-24 and the fractional steps — stays available.
      spacing: {
        1: "var(--space)" /* 4px  */,
        2: "calc(var(--space) * 2)" /* 8px  */,
        3: "calc(var(--space) * 3)" /* 12px */,
        4: "calc(var(--space) * 4)" /* 16px */,
        5: "calc(var(--space) * 5)" /* 20px */,
        6: "calc(var(--space) * 6)" /* 24px */,
        8: "calc(var(--space) * 8)" /* 32px */,
        10: "calc(var(--space) * 10)" /* 40px */,
        12: "calc(var(--space) * 12)" /* 48px */,
        16: "calc(var(--space) * 16)" /* 64px */,
      },
      boxShadow: {
        // Focus edge-glow (style-guide §1.4). Ring in --accent-ink, not raw
        // --laser: a 1px laser stroke on light is the contrast-law FAIL (§6).
        // The glow reads --laser-glow (DSN-005) so retuning it can't silently
        // fork the composer ring from every other focus ring. (boxShadow.hair
        // and backgroundColor.glass dropped — zero consumers, DEAD-003.)
        focus: "0 0 0 1px var(--accent-ink), 0 0 24px var(--laser-glow)",
      },
    },
  },
  plugins: [],
};

export default config;

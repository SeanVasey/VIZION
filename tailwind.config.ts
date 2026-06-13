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
    // 4px base unit, 8-pt rhythm (per FINAL_PLAN §2).
    spacing: {
      px: "1px",
      0: "0",
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
    colors: {
      transparent: "transparent",
      current: "currentColor",
      // The seven locked roles (FINAL_PLAN §2) + Amber warning.
      void: "var(--void)",
      "void-2": "var(--void-2)",
      lift: "var(--lift)",
      onyx: "var(--onyx)",
      silver: "var(--silver)",
      chalk: "var(--chalk)",
      laser: "var(--laser)",
      "on-laser": "var(--on-laser)",
      accent: "var(--accent-ink)",
      pulse: "var(--pulse)",
      flare: "var(--flare)",
      amber: "var(--amber)",
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
      backdropBlur: {
        glass: "16px",
      },
      boxShadow: {
        // Laser focus edge-glow (style-guide §1.4).
        focus: "0 0 0 1px var(--laser), 0 0 24px rgba(183, 255, 60, 0.25)",
        hair: "inset 0 0 0 1px var(--hair)",
      },
      borderColor: {
        hair: "var(--hair)",
      },
      backgroundColor: {
        glass: "var(--glass)",
      },
    },
  },
  plugins: [],
};

export default config;

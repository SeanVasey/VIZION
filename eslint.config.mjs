import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import tailwind from "eslint-plugin-tailwindcss";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/**
 * Class names this project defines itself, in `src/styles/*.css`.
 *
 * `no-custom-classname` flags any token Tailwind does not recognise, which is
 * the point — but these come from our own `@layer components` / `@layer
 * utilities` blocks, so they have to be declared or the rule buries its signal
 * under ~35 false positives.
 *
 * An explicit list rather than one parsed out of the CSS at lint time: a
 * generated allowlist would absorb a typo in the CSS too, and the whole point of
 * the rule is that a name nobody defined gets noticed.
 */
const PROJECT_CLASSNAMES = [
  // Ambient background layers.
  "bg-nebula",
  "bg-nebula-bloom",
  "bg-nebula-bloom-a",
  "bg-nebula-bloom-b",
  "bg-nebula-bloom-c",
  "bg-nebula-bloom-d",
  "bg-nebula-ground",
  "nebula-canvas",
  // Buttons + surfaces (@layer components).
  "ambient-scrim",
  "btn-destructive",
  "btn-laser",
  "btn-secondary",
  "glass",
  "glass-chrome",
  "glass-nav",
  "hover-hair",
  "pill",
  // Chrome + motion.
  "horizon",
  "horizon-node",
  "horizon-rule",
  "nav-tab",
  "pressable",
  "result-shimmer",
  "sheet-in",
  "footer-fade-in",
  "skeleton",
  "spinner",
  "stream-progress-sweep",
  "stream-progress-track",
  // Layout / behaviour utilities (@layer utilities).
  "cap-trim",
  "mono",
  "no-pull-refresh",
  "pb-safe",
  "pl-safe",
  "pr-safe",
  "pt-safe",
  "scroll-row",
  "tap-44",
  // Dev-only accents (dev-accents.css).
  "dev-edge",
  "dev-mark",
];

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "public/sw.js",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  /**
   * Tailwind class validation.
   *
   * WHY THIS EXISTS. A botched patch left `itemsateems-center` in a className
   * (PR #58). Tailwind emitted no rule for it, so the Save button silently lost
   * its vertical centering — and lint, typecheck, 748 unit tests, the e2e suite
   * and the production build were ALL green, because nothing in that gate asks
   * whether a utility exists. A review bot caught what five steps could not.
   *
   * Only `no-custom-classname` is enabled. The plugin's other rules
   * (`classnames-order`, `enforces-shorthand`, …) are formatting opinions that
   * would rewrite most of the codebase in one commit and bury real defects in
   * churn. This rule alone answers the question the gate could not: does this
   * class name mean anything?
   */
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { tailwindcss: tailwind },
    settings: {
      tailwindcss: {
        // ABSOLUTE. The plugin derives its module-resolution root from
        // `dirname(config)`, so a relative "tailwind.config.ts" yields "." and it
        // fails with "Could not resolve tailwindcss" even though the package is
        // right there.
        config: join(__dirname, "tailwind.config.ts"),
        whitelist: PROJECT_CLASSNAMES,
      },
    },
    rules: {
      "tailwindcss/no-custom-classname": "error",
    },
  },
];

export default eslintConfig;

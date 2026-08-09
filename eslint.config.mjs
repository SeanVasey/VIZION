import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import tailwind from "eslint-plugin-tailwindcss";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

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
   *
   * Project-defined classes (src/styles) are accepted by the plugin's default
   * CSS scan (`cssFiles` covers every non-vendored .css at lint time), so a
   * class is
   * legal exactly when some stylesheet defines it — and a TSX typo that no
   * stylesheet defines is still flagged. An explicit allowlist used to sit
   * here claiming to be the mechanism; it had silently fallen ~13 classes
   * behind while lint stayed green, because the scan was doing the work
   * (cleanup audit 04, css-01 — retired 2026-08-09 with owner approval).
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
      },
    },
    rules: {
      "tailwindcss/no-custom-classname": "error",
    },
  },
];

export default eslintConfig;

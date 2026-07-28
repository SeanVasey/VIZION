import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "Reduced effects" (Settings → Appearance) promises to silence the AMBIENT
 * layers. Every decorative layer added to the stylesheet has to answer to it,
 * or the toggle quietly stops meaning what the label says — a promise that
 * degrades silently is worse than one never made.
 */
const CSS = readFileSync(
  join(__dirname, "..", "..", "src", "styles", "globals.css"),
  "utf8",
);
const TOKENS = readFileSync(
  join(__dirname, "..", "..", "src", "styles", "tokens.css"),
  "utf8",
);

/**
 * Every selector that actually sits in a `[data-reduced-effects] …` rule head.
 *
 * Built structurally, and from comment-stripped CSS, because the obvious
 * version is not safe: splitting the raw file on the literal
 * "[data-reduced-effects]" takes everything after the FIRST occurrence — and
 * once any explanatory comment mentions the attribute, that first occurrence
 * moves above the component definitions and the remainder contains every
 * selector in the file. The assertion then passes on a rule's own definition
 * rather than on its gate. That is not hypothetical: it happened here.
 */
const GATED_SELECTORS: string[] = (() => {
  const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  for (const match of stripped.matchAll(/([^{}]+)\{/g)) {
    const head = match[1]!;
    if (!head.includes("[data-reduced-effects]")) continue;
    for (const selector of head.split(",")) out.push(selector.trim());
  }
  return out;
})();

describe("reduced-effects gate covers every ambient layer", () => {
  it("finds the gated rules at all", () => {
    // Guards the guard: a parser that matched nothing would make every
    // assertion below fail loudly rather than silently, but a parser that
    // matched the WHOLE FILE would make them all pass. Pin the shape.
    expect(GATED_SELECTORS.length).toBeGreaterThan(3);
    expect(GATED_SELECTORS.every((s) => s.includes("[data-reduced-effects]"))).toBe(true);
  });

  it.each([
    ".bg-aurora",
    ".mesh-canvas",
    ".result-shimmer::before",
    ".glass",
    ".dev-edge",
  ])("%s is gated", (selector) => {
    expect(
      GATED_SELECTORS.some((s) => s.endsWith(` ${selector}`)),
      `no [data-reduced-effects] rule targets ${selector}`,
    ).toBe(true);
  });

  it("silences the glass grain specifically, not just some glass property", () => {
    const glassRule = /\[data-reduced-effects\]\s+\.glass\s*\{([^}]*)\}/.exec(CSS);
    expect(glassRule).not.toBeNull();
    expect(glassRule![1]).toMatch(/background-image:\s*none/);
  });
});

describe("glass depth tokens", () => {
  it("defines grain and sheen for both themes", () => {
    // Dark (:root) + light — two definitions each, plus the system-preference
    // block, so a theme can never fall back to the other theme's values.
    expect(TOKENS.match(/--grain:/g)?.length).toBeGreaterThanOrEqual(2);
    expect(TOKENS.match(/--glass-sheen:/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the grain self-contained — no network fetch under CSP", () => {
    for (const match of TOKENS.matchAll(/--grain:\s*url\("([^"]*)"\)/g)) {
      expect(match[1]!.startsWith("data:image/svg+xml,")).toBe(true);
    }
  });

  it("uses an INSET sheen so no panel grows a drop shadow", () => {
    for (const match of TOKENS.matchAll(/--glass-sheen:\s*([^;]*);/g)) {
      expect(match[1]!.trim().startsWith("inset")).toBe(true);
    }
  });

  it("leaves the chrome bars' blur on their ::before layer (iOS rule)", () => {
    // backdrop-filter directly on fixed/sticky chrome detaches it from the
    // viewport edge in WebKit; the bars must keep using the pseudo-layer.
    expect(CSS).toMatch(
      /\.glass-chrome::before,\s*\n\s*\.glass-nav::before\s*\{[^}]*backdrop-filter/,
    );
    const barRule = /\n\s*\.glass-chrome,\s*\n\s*\.glass-nav\s*\{([^}]*)\}/.exec(CSS);
    expect(barRule).not.toBeNull();
    expect(barRule![1]).not.toMatch(/backdrop-filter/);
  });
});

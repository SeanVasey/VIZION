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

/** The block of selectors gated behind the root attribute. */
const GATED = CSS.split("[data-reduced-effects]").slice(1).join("\n");

describe("reduced-effects gate covers every ambient layer", () => {
  it.each([".bg-aurora", ".mesh-canvas", ".result-shimmer::before", ".glass"])(
    "%s is gated",
    (selector) => {
      expect(GATED).toContain(selector);
    },
  );

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

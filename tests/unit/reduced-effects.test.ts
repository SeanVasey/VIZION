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
    ".bg-nebula-bloom",
    ".nebula-canvas",
    ".result-shimmer::before",
    ".glass",
    ".glass-solid",
    ".dev-edge",
    ".horizon-node",
    // The capsule's frosted ground and the resting dial's pulse ring — both
    // added with the halo redesign, both decorative, both therefore owing the
    // toggle an answer.
    ".hold-slider-glass",
    ".hold-hint-pulse::after",
    // The ultra flood (2026-08-15): under the toggle it settles instantly —
    // at the ultra stops the fill simply IS violet, no sweep.
    ".hold-slider-wash",
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

  it("ships the halo's mask both prefixed and unprefixed", () => {
    // The halo's soft edge is a mask over a backdrop-filter — the app's first
    // use of mask-image anywhere. It carries the -webkit- prefix for the same
    // reason backdrop-filter and background-clip: text do, and the unprefixed
    // property so it survives the prefix's retirement. Measured 2026-08-11:
    // Chromium gates the filter with it; the WebKitGTK e2e build paints no
    // backdrop-filter at all, so real Safari is unverified — which is exactly
    // why the localization lives in the ELEMENT'S BOX (HoldSlider sizes it)
    // and this mask only softens the edge.
    const rule = /\n\s*\.hold-slider-blur\s*\{([^}]*)\}/.exec(CSS);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/-webkit-mask-image:\s*radial-gradient/);
    expect(rule![1]).toMatch(/(^|[\s;])mask-image:\s*radial-gradient/);
  });

  it("localizes the dim instead of washing the viewport", () => {
    // What shipped first was a flat `--void 62%` fill over `fixed inset-0`,
    // which on the light theme is 62% of a near-white across the whole screen
    // (owner's red X, 2026-08-11). The dim keeps its full-viewport BOX — it is
    // the input shield — and localizes in its paint, so this rule must be a
    // radial gradient reading the capsule's centre, never a flat fill.
    const rule = /\n\s*\.hold-slider-scrim\s*\{([^}]*)\}/.exec(CSS);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/background-image:\s*radial-gradient/);
    expect(rule![1]).toMatch(/var\(--dial-cx/);
    expect(rule![1]).not.toMatch(/background-color/);
  });

  it("composes the capsule's lift shadow over the sheen, never replacing it", () => {
    // box-shadow is a single property and the level chip also carries
    // `.glass-solid`, whose sheen this would otherwise wipe. Sheen first.
    const rule = /\n\s*\.hold-slider-lift\s*\{([^}]*)\}/.exec(CSS);
    expect(rule).not.toBeNull();
    const shadow = /box-shadow:\s*([\s\S]*?);/.exec(rule![1]!)![1]!;
    expect(shadow.trim().startsWith("var(--glass-sheen)")).toBe(true);
    expect(shadow).toMatch(/var\(--void\)/);
  });

  it("leaves the FAB's blur on its ::before layer too (same iOS rule)", () => {
    // `.fab-glass` is fixed, so it is under the same constraint as the bars.
    const pseudo = /\n\s*\.fab-glass::before\s*\{([^}]*)\}/.exec(CSS);
    expect(pseudo).not.toBeNull();
    expect(pseudo![1]).toMatch(/backdrop-filter:\s*blur/);
    const own = /\n\s*\.fab-glass\s*\{([^}]*)\}/.exec(CSS);
    expect(own).not.toBeNull();
    expect(own![1]).not.toMatch(/backdrop-filter/);
  });

  it("keeps the FAB's Laser fill translucent but dominant", () => {
    // The whole point of the frost: solid would be back to obscuring, and too
    // thin would spend the §6 ink margin and the accent's presence at once.
    const pseudo = /\n\s*\.fab-glass::before\s*\{([^}]*)\}/.exec(CSS)![1]!;
    const mix = /color-mix\(in srgb,\s*var\(--laser\)\s*(\d+)%/.exec(pseudo);
    expect(
      mix,
      "the FAB fill must be a --laser color-mix, not a raw token",
    ).not.toBeNull();
    const pct = Number(mix![1]);
    expect(pct).toBeGreaterThanOrEqual(75);
    expect(pct).toBeLessThan(100);
  });

  it("composes the focus ring in front of the FAB's resting shadow", () => {
    // box-shadow is one property: a components-layer shadow replaces the
    // base-layer :focus-visible ring outright unless the ring is re-included.
    const focus = /\n\s*\.fab-glass:focus-visible\s*\{([^}]*)\}/.exec(CSS);
    expect(focus).not.toBeNull();
    expect(focus![1]).toMatch(/var\(--focus-ring\)/);
  });

  it("stands the FAB's blur down while the page is moving", () => {
    // It is fixed over a scrolling list, so its snapshot is re-blurred every
    // frame — the strongest case in the app for the scroll gate.
    expect(CSS).toMatch(
      /\[data-scrolling\]\s+\.fab-glass::before\s*\{[^}]*backdrop-filter:\s*none/,
    );
  });
});

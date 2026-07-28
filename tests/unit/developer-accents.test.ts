import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEVELOPER_ORDER } from "@/lib/constants";

/**
 * The token contract for the per-developer library accents.
 *
 * These are checked as TEXT rather than through a DOM, deliberately: jsdom
 * loads no stylesheets, so a rendering assertion here would pass whatever the
 * CSS said. What can be proven at this level is that the layer stays in step
 * with the model roster and that the two constructions the design's contrast
 * figures depend on are still constructed that way.
 */
const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const RAW_ACCENTS = read("src/styles/dev-accents.css");
const RAW_GLOBALS = read("src/styles/globals.css");

/** Comments stripped — an assertion a comment can satisfy is not a test. */
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const ACCENTS = strip(RAW_ACCENTS);
const GLOBALS = strip(RAW_GLOBALS);

describe("the accent layer tracks the developer roster", () => {
  it("defines an accent for every developer, and none for anything else", () => {
    const declared = [...ACCENTS.matchAll(/--dev-([a-z]+):\s*#/g)].map((m) => m[1]!);
    expect([...declared].sort()).toEqual([...DEVELOPER_ORDER].sort());
  });

  it("is imported, or every card silently loses its colour", () => {
    // A `var(--dev-x)` that resolves to nothing takes the .dev-mark fallback
    // and renders --silver — a working card with no identity, which is exactly
    // the kind of failure that ships unnoticed.
    expect(GLOBALS).toContain('@import "./dev-accents.css"');
  });

  it("leaves the LOCKED token file alone", () => {
    const tokens = read("src/styles/tokens.css");
    expect(tokens).not.toContain("--dev-");
    expect(tokens).not.toContain("--on-flare");
  });
});

describe("one hex per developer, in both themes", () => {
  it("declares no accent inside a light block", () => {
    // The palette's whole property is that each value clears 3:1 against BOTH
    // composited card fills, so it needs no light override. Adding one would
    // destroy the property it was derived to have.
    const lightBlocks = [
      ...ACCENTS.matchAll(/:root\[data-theme="light"\]\s*\{([^}]*)\}/g),
      ...ACCENTS.matchAll(/:root\[data-theme="system"\]\s*\{([^}]*)\}/g),
    ].map((m) => m[1]!);
    expect(lightBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of lightBlocks) {
      // Matched against the roster, not a `--dev-*` wildcard: `--dev-peak` and
      // the radii legitimately live in the light blocks, so a wildcard here
      // would fail on the tokens that are SUPPOSED to swap.
      for (const developer of DEVELOPER_ORDER) {
        expect(block).not.toContain(`--dev-${developer}:`);
      }
    }
  });

  it("swaps the two tokens that genuinely are theme-dependent, in BOTH light blocks", () => {
    // tokens.css declares the light theme twice — once for an explicit choice
    // and once for the system-preference path — so a token written into only
    // one of them leaves system-light users on dark values.
    expect(ACCENTS.match(/--dev-peak:/g)?.length).toBe(3);
    expect(ACCENTS.match(/--on-flare:/g)?.length).toBe(3);
  });
});

describe("the constructions the contrast figures rest on", () => {
  it("keeps the field's horizontal reach equal to the card's content gutter", () => {
    // An accent-coloured glyph sitting inside its own tint fails WCAG 1.4.11
    // at a tint of only ~8%. The mark is safe because the field's alpha is
    // identically zero at every x past the gutter the card already reserves —
    // `pr-12`, 48px. These two numbers are a PAIR: moving one without the
    // other silently puts the mark inside its own colour.
    expect(ACCENTS).toMatch(/--dev-rx:\s*48px/);
    expect(read("src/components/library/LibraryBrowser.tsx")).toContain("p-4 pr-12");
  });

  it("keeps the field's vertical reach proportional, not a fixed length", () => {
    // Card height varies with the preview (nullable) and with title wrapping.
    // A fixed px radius would make how much colour a card carries a function
    // of how long its preview happens to be.
    expect(ACCENTS).toMatch(/--dev-ry:\s*\d+%/);
  });

  it("keeps the overlay's radius in step with the card's", () => {
    // .dev-edge is inset 1px inside a rounded-2xl (1rem) card; if the card's
    // radius changes, a mismatched overlay shows as a bright corner sliver.
    expect(GLOBALS).toMatch(/\.dev-edge\s*\{[^}]*border-radius:\s*calc\(1rem - 1px\)/);
    expect(read("src/components/library/LibraryBrowser.tsx")).toContain(
      "block rounded-2xl p-4 pr-12",
    );
  });
});

describe("the focus ring the card had lost", () => {
  it("draws an INSET ring on the overlay, not an outset one on the card", () => {
    // The row is overflow-hidden (load-bearing: without it a swiped card runs
    // 84px past its own track), and overflow:hidden clips every outset shadow
    // a descendant draws — which is why the card had no visible keyboard focus
    // indicator at all. Only an inset ring survives the clip.
    const rule = /\.glass:focus-visible\s*~\s*\.dev-edge\s*\{([^}]*)\}/.exec(GLOBALS);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/box-shadow:\s*inset\s/);
    expect(rule![1]).toContain("var(--accent-ink)");
  });

  it("gates the field on the swipe, never the ring", () => {
    // Gating `opacity` would take the focus ring with it, and a row can be
    // keyboard-focused and then swiped by the same hybrid-input user.
    const rule = /\.dev-edge\[data-swiping\]\s*\{([^}]*)\}/.exec(GLOBALS);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/--dev-peak:\s*0%/);
    expect(rule![1]).not.toMatch(/opacity|display|visibility/);
  });
});

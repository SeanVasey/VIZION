import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Brand-mark geometry contract.
 *
 * `src/components/BrandMark.tsx` inlines the master glyph's path so the mark
 * can take `currentColor` and follow the theme, which an <img> cannot. Inlining
 * duplicates the geometry, and duplicated geometry drifts: a re-cut of
 * `public/brand/vizion-glyph.svg` would change every generated icon derivative
 * (scripts/generate-icons.mjs reads the same file) while leaving the in-app
 * mark silently on the old shape — exactly the split this PR closed.
 *
 * So the duplication is allowed but not unguarded: if the master moves, this
 * fails and names the file to update.
 */
const ROOT = join(__dirname, "..", "..");
const MASTER = join(ROOT, "public", "brand", "vizion-glyph.svg");
const COMPONENT = join(ROOT, "src", "components", "BrandMark.tsx");

const master = readFileSync(MASTER, "utf8");
const component = readFileSync(COMPONENT, "utf8");

const masterViewBox = master.match(/viewBox="([^"]+)"/)?.[1];
const masterPath = master.match(/<path[^>]*\bd="([^"]+)"/)?.[1];
const componentViewBox = component.match(/viewBox="([^"]+)"/)?.[1];
const componentPath = component.match(/\bd="([^"]+)"/)?.[1];

describe("BrandMark mirrors the master glyph", () => {
  it("the master still parses (single path, explicit viewBox)", () => {
    expect(masterViewBox, "vizion-glyph.svg lost its viewBox").toBeTruthy();
    expect(masterPath, "vizion-glyph.svg lost its <path d>").toBeTruthy();
    expect(
      (master.match(/<path/g) ?? []).length,
      "the master gained a second path — BrandMark and generate-icons.mjs both assume one",
    ).toBe(1);
  });

  it("the component carries the master's viewBox", () => {
    expect(componentViewBox).toBe(masterViewBox);
  });

  it("the component carries the master's path verbatim", () => {
    expect(componentPath).toBe(masterPath);
  });

  it("the mark is drawn with currentColor, never a hardcoded fill", () => {
    // DeveloperIcon's colour rule (guardrail §6 contrast law): the parent's
    // text colour governs, so the mark stays AA-legible when the theme flips.
    expect(component).toContain('fill="currentColor"');
    expect(component).not.toMatch(/fill="#[0-9a-fA-F]{3,8}"/);
  });

  it("preserves the evenodd fill rule the glyph's counters depend on", () => {
    expect(master).toContain('fill-rule="evenodd"');
    expect(component).toContain('fillRule="evenodd"');
  });
});

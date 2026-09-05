import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OUTLINE_WIDTH,
  SCALABLE_ICON,
  outlinedColorway,
} from "../../scripts/generate-icons.mjs";

/**
 * Source contract for the adaptive SVG. These assertions do not establish
 * iPhone installation selection or live Home Screen appearance updates.
 * The Apple PNG is deliberately declared in the production head.
 *
 * Presentation fill has zero specificity and is overridden by .plate. The
 * attribute supplies a deterministic lime background without stylesheet
 * processing. Real browser pixels, including the dark override, are checked
 * separately in icon-repair.spec.ts; stripped-style pixels are also covered
 * by the executable asset verifier. Neither is an iOS Home Screen test.
 */
const ROOT = join(__dirname, "..", "..");
const SVG = readFileSync(join(ROOT, "public", "icons", SCALABLE_ICON), "utf8");
const C = outlinedColorway();

function token(name: string) {
  const css = readFileSync(join(ROOT, "src", "styles", "tokens.css"), "utf8");
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!m) throw new Error(`tokens.css: --${name} not found`);
  return m[1]!.toUpperCase();
}

/** The two stops of a named linearGradient, in document order. */
function stops(id: string) {
  const g = SVG.match(
    new RegExp(`<linearGradient id="${id}"[^>]*>(.*?)</linearGradient>`, "s"),
  );
  if (!g) throw new Error(`app-icon.svg: no linearGradient#${id}`);
  return [...g[1]!.matchAll(/stop-color="(#[0-9a-fA-F]{6})"/g)].map((m) =>
    m[1]!.toUpperCase(),
  );
}

const style = SVG.match(/<style>(.*?)<\/style>/s)?.[1] ?? "";
const defaultRules = style.slice(0, style.indexOf("@media"));
const darkRules =
  style.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{(.+)\}\s*$/s)?.[1] ?? "";

/** Every painted <rect>/<path>, in document order, as its attribute string. */
const painted = SVG.match(/<(?:rect|path)\b[^>]*>/g) ?? [];
const paths = painted.filter((el) => el.startsWith("<path"));
const rect = painted.find((el) => el.startsWith("<rect"));

describe("app-icon.svg — the outlined tile, both appearances", () => {
  it("defaults to the LIGHT appearance: a flat Laser plate", () => {
    expect(style, "there is a stylesheet carrying the swap").not.toBe("");
    expect(defaultRules).toContain(`.plate{fill:${C.plate}}`);
    expect(C.plate, "the plate IS --laser").toBe(token("laser"));
    expect(SVG, "the plate is flat — no plate gradient").not.toContain('id="plate"');
    expect(rect, "a full-bleed plate rect").toBeDefined();
    expect(rect).toContain('class="plate"');
    expect(rect).toContain('width="1024"');
    expect(rect).toContain('height="1024"');
  });

  it("swaps the plate to Void in dark — and only the plate", () => {
    expect(darkRules, "one dark override block").not.toBe("");
    expect(darkRules).toContain(".plate{fill:url(#plate-dark)}");
    expect(stops("plate-dark")).toEqual([C.plateDarkTop, C.plateDarkBottom]);
    expect(C.plateDarkBottom, "the dark plate rests on --void").toBe(token("void"));
    expect(darkRules, "the mark must not swap").not.toMatch(/mark|glyph|stroke/);
    expect(
      SVG,
      "the only appearance branch is the dark OVERRIDE; a light branch means the default flipped",
    ).not.toContain("prefers-color-scheme:light");
  });

  it("keeps a token-derived presentation fallback without an inline style", () => {
    expect(rect).toContain(`fill="${C.plate}"`);
    expect(rect).not.toMatch(/\sstyle="/);
    expect(defaultRules).toContain(`.plate{fill:${C.plate}}`);
    expect(darkRules).toContain(".plate{fill:url(#plate-dark)}");
  });

  /**
   * The stroke is a second copy of the path painted FIRST, so only its outer
   * half shows and the fill keeps its full geometry. Neither path swaps: the
   * mark is the same outlined mark on both plates.
   */
  it("keeps the outlined mark in both appearances — stroke under fill, no swap", () => {
    expect(paths, "exactly two paths: the stroke, then the fill").toHaveLength(2);
    const [stroke, fill] = paths as [string, string];
    expect(stroke).toContain('fill="none"');
    expect(stroke).toContain(`stroke="${C.outline}"`);
    expect(stroke).toContain(`stroke-width="${OUTLINE_WIDTH}"`);
    expect(stroke).toContain('stroke-linejoin="round"');
    expect(fill).toContain('fill="url(#mark)"');
    expect(fill).toContain('fill-rule="evenodd"');
    expect(fill, "the fill path carries no stroke of its own").not.toContain("stroke=");
    expect(stops("mark")).toEqual([C.markTop, C.markBottom]);
    expect(C.outline, "the outline IS --void").toBe(token("void"));
    const d = (el: string) => el.match(/\sd="([^"]+)"/)?.[1];
    expect(d(stroke)).toBeDefined();
    expect(d(stroke)).toBe(d(fill));
  });

  it("fills the mark with a colour distinct from the plate so iOS keeps it in Dark", () => {
    expect(C.markTop).not.toBe(C.plate);
    expect(C.markBottom).not.toBe(C.plate);
    expect(C.markTop).not.toBe(C.outline);
    expect(C.markBottom).not.toBe(C.outline);
  });

  it("declares color-scheme so a renderer resolves a scheme at all", () => {
    expect(SVG).toContain("color-scheme:light dark");
  });

  it("is a plain full-bleed square — no clip, no filter, no baked corners", () => {
    expect(SVG).not.toContain("<clipPath");
    expect(SVG).not.toContain("<filter");
    expect(SVG).not.toContain(" rx=");
    expect(SVG).toContain('viewBox="0 0 1024 1024"');
  });
});

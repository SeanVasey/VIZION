import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OUTLINE_WIDTH,
  SCALABLE_ICON,
  outlinedColorway,
} from "../../scripts/generate-icons.mjs";

/**
 * The scalable app icon — the outlined tile as vector, carrying BOTH
 * appearances (ADR-0017 amendment 2).
 *
 * This file is the manifest's first `any` entry and the first `rel="icon"`;
 * Safari 26 uses manifest icons, SVG included, for the Home Screen. It is the
 * one icon surface that can DECLARE a dark appearance: the plate is a CSS
 * class whose fill swaps under `prefers-color-scheme: dark` from the Laser
 * ramp to a Void plate, while the MARK stays the outlined mark in both — the
 * stroke carries it on green, the fill on dark.
 *
 * What is asserted here is the source contract: the default rules are the
 * LIGHT appearance (a media-blind renderer paints the default, and a captured
 * green tile is the one iOS's own dark pass separates, mark kept; a captured
 * dark tile would stay dark in light appearance — the ADR-0015 outcome the
 * owner rejected); the dark override swaps ONLY the plate; the rect carries
 * no `fill` attribute that would outrank the class; the mark's paths are the
 * stroke-under-fill pair and do not swap. That the swap actually PAINTS is a
 * separate question a string cannot answer, and it is answered by render in
 * tests/e2e/shell.spec.ts ("the app icon's plate follows the appearance; the
 * outlined mark does not").
 *
 * The colours come from the generator, which derives them from tokens.css —
 * not restated here (tasks/lessons.md: icon art authored beside the token file
 * has already drifted a full hue band once). The two token reads below keep
 * the generator honest about that derivation.
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
  it("defaults to the LIGHT appearance: the Laser plate", () => {
    expect(style, "there is a stylesheet carrying the swap").not.toBe("");
    expect(defaultRules).toContain(".plate{fill:url(#plate)}");
    expect(stops("plate")).toEqual([C.plateTop, C.plateBottom]);
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

  /**
   * A `fill` ATTRIBUTE on the rect would outrank the class rules in the
   * cascade and the swap would never apply — the icon would parse, carry a
   * correct-looking media query, and stay green in dark.
   */
  it("carries no fill attribute on the plate that would shadow the swap", () => {
    expect(rect, `${rect} pins a fill, which outranks the class rules`).not.toMatch(
      /\sfill="/,
    );
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
    expect(C.markBottom, "the mark's base IS --laser").toBe(token("laser"));
    expect(C.outline, "the outline IS --void").toBe(token("void"));
    const d = (el: string) => el.match(/\sd="([^"]+)"/)?.[1];
    expect(d(stroke)).toBeDefined();
    expect(d(stroke)).toBe(d(fill));
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

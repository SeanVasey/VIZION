import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OUTLINE_WIDTH,
  SCALABLE_ICON,
  outlinedColorway,
} from "../../scripts/generate-icons.mjs";

/**
 * The scalable app icon — the outlined tile as vector, ONE colorway.
 *
 * This file is the manifest's first `any` entry and the modern browser tab's
 * icon. Under ADR-0015 it carried both appearances behind `prefers-color-
 * scheme`, with the dark colorway as the default so a media-blind renderer
 * landed on the branch that could not degrade — a whole mechanism whose only
 * job was to keep the mark legible on whichever plate the appearance chose.
 * The outlined colorway (ADR-0017) makes the mark legible on either plate by
 * construction, so the swap is gone, and what is asserted here is the source
 * contract of the artwork that replaced it: the Laser lighting ramp on the
 * plate, the Laser ramp on the mark, the Void outline painted UNDER the fill,
 * and no appearance branch left to reintroduce the old fragility.
 *
 * That the artwork actually PAINTS that way is a separate question a string
 * cannot answer, and it is answered by render in tests/e2e/shell.spec.ts ("the
 * app icon is one outlined colorway, and does not move with the appearance").
 * Both halves are needed.
 *
 * The colours come from the generator, which derives them from tokens.css —
 * not restated here, for the reason generate-icons.mjs gives: icon art
 * authored beside the token file instead of from it has already drifted a full
 * hue band once (tasks/lessons.md). The two checks that read tokens.css
 * directly are there to keep the generator honest about that derivation, not
 * to hold a second opinion about the brand green.
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

/** Every painted <rect>/<path>, in document order, as its attribute string. */
const painted = SVG.match(/<(?:rect|path)\b[^>]*>/g) ?? [];
const paths = painted.filter((el) => el.startsWith("<path"));

describe("app-icon.svg — the outlined tile, one colorway", () => {
  it("paints the plate with the Laser lighting ramp, top-lit", () => {
    expect(stops("plate")).toEqual([C.plateTop, C.plateBottom]);
    const rect = painted.find((el) => el.startsWith("<rect"));
    expect(rect, "a full-bleed plate rect").toBeDefined();
    expect(rect).toContain('fill="url(#plate)"');
    expect(rect).toContain('width="1024"');
    expect(rect).toContain('height="1024"');
  });

  it("fills the mark with its own ramp, resting on the token at the bottom", () => {
    expect(stops("mark")).toEqual([C.markTop, C.markBottom]);
    expect(C.markBottom, "the mark's base IS --laser, not a tint of it").toBe(
      token("laser"),
    );
  });

  /**
   * The stroke is a second copy of the path painted FIRST, so only its outer
   * half shows and the fill keeps its full geometry. Painting it after the fill
   * (or as a centred stroke on the fill path) would eat half the outline out
   * of the ring, which is barely wider than the stroke.
   */
  it("strokes the mark in Void, under the fill", () => {
    expect(paths, "exactly two paths: the stroke, then the fill").toHaveLength(2);
    const [stroke, fill] = paths as [string, string];
    expect(stroke).toContain('fill="none"');
    expect(stroke).toContain(`stroke="${C.outline}"`);
    expect(stroke).toContain(`stroke-width="${OUTLINE_WIDTH}"`);
    expect(stroke).toContain('stroke-linejoin="round"');
    expect(fill).toContain('fill="url(#mark)"');
    expect(fill).toContain('fill-rule="evenodd"');
    expect(fill, "the fill path carries no stroke of its own").not.toContain("stroke=");
    expect(C.outline, "the outline IS --void").toBe(token("void"));
  });

  it("carries the same geometry on both copies", () => {
    const d = (el: string) => el.match(/\sd="([^"]+)"/)?.[1];
    expect(d(paths[0]!)).toBeDefined();
    expect(d(paths[0]!)).toBe(d(paths[1]!));
  });

  /**
   * ONE colorway. An appearance branch here would be the ADR-0015 machinery
   * creeping back — and with it the question of which branch a media-blind
   * renderer paints, which the outlined artwork exists to make irrelevant.
   */
  it("has no appearance swap left — no media query, no stylesheet", () => {
    expect(SVG).not.toContain("prefers-color-scheme");
    expect(SVG).not.toContain("<style");
    expect(SVG).not.toContain("color-scheme");
  });

  it("is a plain full-bleed square — no clip, no filter, no baked corners", () => {
    expect(SVG).not.toContain("<clipPath");
    expect(SVG).not.toContain("<filter");
    expect(SVG).not.toContain(" rx=");
    expect(SVG).toContain('viewBox="0 0 1024 1024"');
  });
});

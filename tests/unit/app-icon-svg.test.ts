import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OUTLINE_WIDTH,
  SCALABLE_ICON,
  installedColorway,
} from "../../scripts/generate-icons.mjs";

/**
 * Source contract for the adaptive SVG (ADR-0017, Amendment 7: a Laser plate,
 * the charcoal mark, and under it a stroke that IS the Laser token — so it
 * cannot be seen on the light plate and is the outline on the dark one). These
 * assertions do not establish iPhone installation selection or live Home
 * Screen appearance updates. The Apple PNG is deliberately declared in the
 * production head, and its stroke is a different, shaded colour for a reason
 * a vector file does not share (icon-alpha.test.ts).
 *
 * Presentation fill has zero specificity and is overridden by .plate. The
 * attribute supplies a deterministic plate without stylesheet processing.
 * Real browser pixels, including the dark override, are checked separately in
 * icon-repair.spec.ts; stripped-style pixels are also covered by the
 * executable asset verifier. Neither is an iOS Home Screen test.
 */
const ROOT = join(__dirname, "..", "..");
const SVG = readFileSync(join(ROOT, "public", "icons", SCALABLE_ICON), "utf8");
const C = installedColorway();

function token(name: string) {
  const css = readFileSync(join(ROOT, "src", "styles", "tokens.css"), "utf8");
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!m) throw new Error(`tokens.css: --${name} not found`);
  return m[1]!.toUpperCase();
}

/** Relative luminance of a #RRGGBB, for ordering assertions only. */
function luma(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
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

describe("app-icon.svg — Laser plate, charcoal mark, a Laser stroke, both appearances", () => {
  it("defaults to the LIGHT appearance: a flat plate in the Laser token", () => {
    expect(style, "there is a stylesheet carrying the swap").not.toBe("");
    expect(defaultRules).toContain(`.plate{fill:${C.plate}}`);
    expect(C.plate, "the plate IS --laser").toBe(token("laser"));
    expect(luma(C.plate), "a bright plate, far above the mark on it").toBeGreaterThan(
      luma(C.mark) + 100,
    );
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
    expect(darkRules, "the mark must not swap").not.toMatch(/mark|glyph|stroke|path/);
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
   * Amendment 7: the mark is the master path painted twice — the stroke
   * first, the flat charcoal fill over it — so only the stroke's outer half
   * shows. Neither carries a gradient, and neither moves with the appearance.
   */
  it("paints the mark as a stroke under a flat charcoal fill — two paths, no ramp", () => {
    expect(paths, "exactly two paths: the stroke, then the fill").toHaveLength(2);
    const [stroke, fill] = paths as [string, string];
    const d = (el: string) => el.match(/\sd="([^"]+)"/)?.[1];
    expect(d(stroke), "both paths are the same geometry").toBe(d(fill));
    expect(stroke).toContain('fill="none"');
    expect(stroke).toContain(`stroke-width="${OUTLINE_WIDTH}"`);
    expect(stroke, "round joins: a mitre would spike past the chevron's tips").toContain(
      'stroke-linejoin="round"',
    );
    expect(stroke).toContain('stroke-linecap="round"');
    expect(fill).toContain(`fill="${C.mark}"`);
    expect(C.mark, "the mark IS the dark theme's --onyx").toBe(token("onyx"));
    expect(fill).toContain('fill-rule="evenodd"');
    expect(fill, "the fill carries no stroke of its own").not.toContain("stroke");
    expect(SVG, "no mark gradient").not.toContain('id="mark"');
  });

  /**
   * The owner's model, literally (2026-11-28): the stroke is "the same colour
   * as Laser so it isn't visible and blends into the background" in Light, and
   * is the outline once the plate goes dark. A vector consumer evaluates the
   * stylesheet, so here the stroke can be the plate's own colour exactly.
   */
  it("strokes the mark in the Laser token — the light plate's own colour", () => {
    const [stroke] = paths as [string, string];
    expect(stroke).toContain(`stroke="${C.stroke}"`);
    expect(C.stroke, "the stroke IS --laser").toBe(token("laser"));
    expect(C.stroke, "…which is the light plate: invisible there").toBe(C.plate);
    expect(C.stroke, "…and not the dark plate: the outline there").not.toBe(
      C.plateDarkBottom,
    );
    expect(
      luma(C.stroke) - luma(C.plateDarkTop),
      "a bright outline on the dark plate",
    ).toBeGreaterThan(150);
    expect(
      SVG,
      "the shaded stroke belongs to the PNG tiles only — never in the vector file",
    ).not.toContain(C.tileStroke);
  });

  it("fills the mark with a colour distinct from the light plate", () => {
    expect(C.mark).not.toBe(C.plate);
    expect(luma(C.plate) - luma(C.mark), "a visible step, not a tint").toBeGreaterThan(
      100,
    );
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

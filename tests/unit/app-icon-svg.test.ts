import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCALABLE_ICON, installedColorway } from "../../scripts/generate-icons.mjs";

/**
 * Source contract for the adaptive SVG (ADR-0017, Amendment 5: the INVERTED
 * installed tile — a plate in the light theme's --accent-ink, the flat Laser mark, no
 * outline). These assertions do not establish iPhone installation selection
 * or live Home Screen appearance updates. The Apple PNG is deliberately
 * declared in the production head.
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

/** A token as the LIGHT theme block defines it — the colour of the in-app mark on light. */
function lightToken(name: string) {
  const css = readFileSync(join(ROOT, "src", "styles", "tokens.css"), "utf8");
  const block = css.match(/:root\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/);
  if (!block) throw new Error("tokens.css: light theme block not found");
  const m = block[1]!.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!m) throw new Error(`tokens.css: --${name} not found in the light block`);
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

describe("app-icon.svg — the inverted installed tile, both appearances", () => {
  it("defaults to the LIGHT appearance: a flat plate in the light theme's accent ink", () => {
    expect(style, "there is a stylesheet carrying the swap").not.toBe("");
    expect(defaultRules).toContain(`.plate{fill:${C.plate}}`);
    expect(C.plate, "the plate is NOT the Laser token any more").not.toBe(token("laser"));
    expect(
      C.plate,
      "the plate IS the light theme's --accent-ink — the header mark's colour on light",
    ).toBe(lightToken("accent-ink"));
    expect(luma(C.plate), "…but it is still darker than the mark").toBeLessThan(
      luma(C.mark),
    );
    expect(
      luma(C.plate),
      "…and well clear of Void: a green plate, not a dark one",
    ).toBeGreaterThan(luma(token("void")) + 40);
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
   * Amendment 5: the mark is ONE flat path — the Laser token, evenodd, no
   * stroke, no gradient. iOS keeps it on either plate because its colour is
   * distinct from both; the outline that used to be the second carrier is
   * gone from every installed surface (the transparent `any` matrix keeps it).
   */
  it("paints the mark as the flat Laser token — one path, no outline, no ramp", () => {
    expect(paths, "exactly one path: the mark").toHaveLength(1);
    const [mark] = paths as [string];
    expect(mark).toContain(`fill="${C.mark}"`);
    expect(C.mark, "the mark IS --laser").toBe(token("laser"));
    expect(mark).toContain('fill-rule="evenodd"');
    expect(mark, "no stroke of any kind").not.toContain("stroke");
    expect(SVG, "no mark gradient").not.toContain('id="mark"');
  });

  it("fills the mark with a colour distinct from the plate so iOS keeps it in Dark", () => {
    expect(C.mark).not.toBe(C.plate);
    expect(C.mark).not.toBe(C.plateDarkBottom);
    expect(luma(C.mark) - luma(C.plate), "a visible step, not a tint").toBeGreaterThan(
      60,
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

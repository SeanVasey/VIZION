import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The self-inverting app icon — one file carrying both appearances.
 *
 * This is the only icon surface that can follow the OS appearance WITHOUT a
 * re-install: a PNG is one set of pixels, so the apple-touch pair has to pick a
 * colorway at capture and keep it. Safari 26 uses this same scalable icon to
 * represent the site on the Home Screen, which is what makes the swap reach the
 * app icon and not just the tab.
 *
 * What is asserted HERE is the source contract — that both colorways are
 * present, derived from the tokens, and genuinely inverse. That the rule
 * actually PAINTS is a separate question a string cannot answer, and it is
 * answered by render in tests/e2e/shell.spec.ts ("the app icon inverts with the
 * appearance, in one file"). Both halves are needed: markup that parses but
 * never applies would pass this file alone.
 */
const ROOT = join(__dirname, "..", "..");
const SVG = readFileSync(join(ROOT, "public", "icons", "app-icon.svg"), "utf8");

/**
 * Read a token's hex out of tokens.css rather than restating it, for the reason
 * generate-icons.mjs reads it: icon art authored beside the token file instead
 * of from it has already drifted a full hue band once (tasks/lessons.md). A
 * literal here would be that same disconnection with a shorter fuse.
 */
function token(name: string) {
  const css = readFileSync(join(ROOT, "src", "styles", "tokens.css"), "utf8");
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!m) throw new Error(`tokens.css: --${name} not found`);
  return m[1]!.toUpperCase();
}

const LASER = token("laser");
const VOID = token("void");

/**
 * The fills declared for `.plate` / `.glyph` in each branch.
 *
 * The DEFAULT rules are the DARK colorway, deliberately: a renderer that ignores
 * `prefers-color-scheme` inside an SVG paints the default, so the default has to
 * be the colorway that cannot degrade to an invisible emboss. The LIGHT colorway
 * is the OVERRIDE. Flipping these back puts the fragile artwork in the fallback
 * branch — see the "defaults to the dark colorway" test below.
 */
function fills(scope: "light" | "dark") {
  const override = SVG.match(
    /@media\s*\(prefers-color-scheme:\s*light\)\s*\{(.+?)\}\s*<\/style>/s,
  );
  if (!override) throw new Error("app-icon.svg: no prefers-color-scheme:light block");
  const block = scope === "light" ? override[1]! : SVG.slice(0, SVG.indexOf("@media"));
  const read = (cls: string) => {
    const m = block.match(new RegExp(`\\.${cls}\\{fill:(#[0-9a-fA-F]{3,8})\\}`));
    if (!m) throw new Error(`app-icon.svg: no .${cls} fill in the ${scope} rules`);
    return m[1]!.toUpperCase();
  };
  return { plate: read("plate"), glyph: read("glyph") };
}

describe("app-icon.svg — one file, both appearances", () => {
  it("paints a Laser plate under the Void mark in light", () => {
    expect(fills("light")).toEqual({ plate: LASER, glyph: VOID });
  });

  it("paints the exact inverse in dark", () => {
    expect(fills("dark")).toEqual({ plate: VOID, glyph: LASER });
  });

  /**
   * Stated as a relationship rather than two hexes so it survives a retune of
   * either token and still cannot be satisfied by a file that swaps only one
   * layer — which would leave the mark sitting on its own colour, invisible.
   */
  it("is a true inversion, not a one-sided swap", () => {
    const light = fills("light");
    const dark = fills("dark");
    expect(light.plate).not.toBe(light.glyph);
    expect(dark.plate).toBe(light.glyph);
    expect(dark.glyph).toBe(light.plate);
  });

  it("declares color-scheme so a renderer resolves a scheme at all", () => {
    expect(SVG).toContain("color-scheme:light dark");
  });

  /**
   * The FALLBACK branch is the decision, not an implementation detail.
   *
   * A renderer that ignores `prefers-color-scheme` inside an SVG paints the
   * DEFAULT rules — and plenty do; WebKitGTK does, through `<img>` (measured,
   * docs/runbooks/ios-verification.md). So the default has to be the colorway
   * that stays legible under every appearance. The light colorway in that slot
   * is what put an invisible emboss on the home-screen tile: iOS auto-darkens a
   * captured tile, and darkening Void ink on a Laser plate crushes both toward
   * each other. Same rule as pinning the apple-touch tile dark — make the branch
   * a renderer reaches when it understands nothing the one that cannot degrade.
   */
  it("defaults to the dark colorway, so a media-blind renderer lands on the safe one", () => {
    const beforeMedia = SVG.slice(0, SVG.indexOf("@media"));

    expect(beforeMedia).toContain(`.plate{fill:${VOID}}`);
    expect(beforeMedia).toContain(`.glyph{fill:${LASER}}`);
    expect(
      SVG,
      "the only appearance branch is the light OVERRIDE; a dark branch means the default flipped back",
    ).not.toContain("prefers-color-scheme:dark");
  });

  /**
   * A `fill` ATTRIBUTE on the painted elements would win over the class rules in
   * the cascade for the light case and, worse, would keep winning in dark — the
   * icon would parse, carry a correct-looking media query, and never invert.
   */
  it("carries no fill attribute that would shadow the swap", () => {
    for (const el of SVG.match(/<(?:rect|path)\b[^>]*>/g) ?? []) {
      expect(el, `${el} pins a fill, which outranks the class rules`).not.toMatch(
        /\sfill="/,
      );
    }
  });
});

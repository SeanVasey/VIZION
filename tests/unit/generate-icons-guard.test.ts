import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANY_SIZES,
  ICONS_DIR,
  SCALABLE_ICON,
  assertAnyEntriesMatchMatrix,
  assertScalableEntries,
} from "../../scripts/generate-icons.mjs";

/**
 * The `any`-matrix manifest guard (Codex review, PR #105).
 *
 * `scripts/generate-icons.mjs` renders the `any` icons to FROZEN filenames —
 * `icons/icon-${size}.png` — because that matrix is a superset of the manifest
 * (thirteen sizes rendered, five declared; the rest are the chrome tail
 * icon-alpha.test.ts requires), so it cannot be driven by the manifest the way
 * the maskable branch is. The manifest therefore has to AGREE with those names,
 * and the guard is what enforces it.
 *
 * It used to check size only. A declared entry renamed to a still-supported
 * size passed validation, the generator wrote the frozen name as always, and the
 * manifest was left pointing at a file nothing creates — a 404 in the PWA
 * install prompt, arriving silently, which is the exact failure the guard exists
 * to prevent. These tests pin both halves so it cannot regress to size-only.
 */
const ROOT = join(__dirname, "..", "..");

/** Build validator input the same shape `readManifestIcons()` produces. */
function entry(src: string) {
  const px = Math.max(
    ...(String(src.match(/(\d+)\.png$/)?.[1] ?? "0").match(/\d+/g) ?? ["0"]).map(Number),
  );
  return { src, file: join(ROOT, "public", src.replace(/^\//, "")), px };
}

describe("assertAnyEntriesMatchMatrix", () => {
  it("accepts the real manifest as committed", () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, "public", "manifest.webmanifest"), "utf8"),
    );
    const any = (manifest.icons ?? [])
      .filter(
        (i: { src?: string; purpose?: string }) =>
          i.src && /\.png$/i.test(i.src) && !/maskable/i.test(i.purpose ?? ""),
      )
      .map((i: { src: string; sizes?: string }) => ({
        src: i.src,
        file: join(ROOT, "public", i.src.replace(/^\//, "")),
        px: Math.max(
          ...(String(i.sizes ?? "").match(/(\d+)x\1/g) ?? ["512x512"]).map((s) =>
            parseInt(s, 10),
          ),
        ),
      }));

    expect(
      any.length,
      "the manifest should still declare any-purpose icons",
    ).toBeGreaterThan(0);
    expect(() => assertAnyEntriesMatchMatrix(any, ANY_SIZES, ICONS_DIR)).not.toThrow();
  });

  it("rejects a renamed path at a supported size — the 404 this guard exists for", () => {
    // 192 IS in the frozen matrix, so a size-only check passes this happily.
    expect(() =>
      assertAnyEntriesMatchMatrix([entry("/icons/app-192.png")], ANY_SIZES, ICONS_DIR),
    ).toThrow(/frozen paths/);
  });

  it("rejects a size the frozen matrix does not render", () => {
    expect(ANY_SIZES).not.toContain(777);
    expect(() =>
      assertAnyEntriesMatchMatrix([entry("/icons/icon-777.png")], ANY_SIZES, ICONS_DIR),
    ).toThrow(/not in ANY_SIZES/);
  });

  it("names the offending manifest src, so the error is actionable", () => {
    expect(() =>
      assertAnyEntriesMatchMatrix([entry("/icons/app-192.png")], ANY_SIZES, ICONS_DIR),
    ).toThrow(/\/icons\/app-192\.png/);
  });

  it("reports every offender at once, not just the first", () => {
    let message = "";
    try {
      assertAnyEntriesMatchMatrix(
        [entry("/icons/app-192.png"), entry("/icons/icon-777.png")],
        ANY_SIZES,
        ICONS_DIR,
      );
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("/icons/app-192.png");
    expect(message).toContain("/icons/icon-777.png");
  });

  it("accepts every frozen size at its canonical path", () => {
    const all = ANY_SIZES.map((px: number) => entry(`/icons/icon-${px}.png`));
    expect(() => assertAnyEntriesMatchMatrix(all, ANY_SIZES, ICONS_DIR)).not.toThrow();
  });
});

/**
 * The SAME guard, for the shape the one above structurally cannot see.
 *
 * `assertAnyEntriesMatchMatrix` keys on pixel size, and an SVG has none — so
 * when the self-inverting scalable icon was added to the manifest it went
 * through `readManifestIcons()` unvalidated, and the manifest could have named
 * any path at all while the generator wrote `app-icon.svg` as always. That is
 * the #105 failure reopened in a new shape, and it is worse here than for a
 * raster entry: the scalable icon is declared FIRST, so it is what a modern
 * consumer reaches for before any PNG, and a 404 there is the whole icon.
 */
function svgEntry(src: string) {
  return { src, file: join(ROOT, "public", src.replace(/^\//, "")) };
}

describe("assertScalableEntries", () => {
  it("accepts the real manifest as committed", () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, "public", "manifest.webmanifest"), "utf8"),
    );
    const scalable = (manifest.icons ?? [])
      .filter((i: { src?: string }) => i.src && /\.svg$/i.test(i.src))
      .map((i: { src: string }) => svgEntry(i.src));

    expect(
      scalable.length,
      "the manifest should declare the self-inverting scalable icon",
    ).toBeGreaterThan(0);
    expect(() => assertScalableEntries(scalable, ICONS_DIR)).not.toThrow();
  });

  it("rejects a renamed scalable entry — the silent 404 this guard exists for", () => {
    expect(() =>
      assertScalableEntries([svgEntry("/icons/vizion-app.svg")], ICONS_DIR),
    ).toThrow(/frozen path/);
  });

  it("names the offending manifest src, so the error is actionable", () => {
    expect(() =>
      assertScalableEntries([svgEntry("/icons/vizion-app.svg")], ICONS_DIR),
    ).toThrow(/\/icons\/vizion-app\.svg/);
  });

  it("rejects the retired favicon.svg, which nothing writes any more", () => {
    expect(() =>
      assertScalableEntries([svgEntry("/icons/favicon.svg")], ICONS_DIR),
    ).toThrow(new RegExp(SCALABLE_ICON));
  });

  it("accepts the canonical path", () => {
    expect(() =>
      assertScalableEntries([svgEntry(`/icons/${SCALABLE_ICON}`)], ICONS_DIR),
    ).not.toThrow();
  });
});

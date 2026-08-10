// VIZION PWA icon + splash generator.
//
// Renders the full brand asset matrix (the transparent `any` icons, maskable
// tiles, apple-touch-icon, favicons + favicon.ico, the Next.js App Router
// convention icons, and the iOS splash screens) from ONE master SVG using
// sharp. Run with: node scripts/generate-icons.mjs
//
// SOURCE OF TRUTH — public/brand/vizion-glyph.svg
// ----------------------------------------------
// The iOS 26 "Liquid Glass" icon set landed in public/brand/ as an Icon
// Composer export: a master glyph, per-appearance composed previews, and the
// separated background/foreground layers. Only ONE of those files is a valid
// raster source, and this script reads only that one:
//
//   • vizion-glyph.svg — the mark alone, flat, tight viewBox (1024 × 892.8),
//     a single evenodd <path>. This is the geometry every derivative is
//     composed from, painted here with the Light/Dark/mono colorways.
//
// The composed previews (vizion-icon-{light,dark,clear,tinted}.svg) and the
// background layers (vizion-icon-bg-{light,dark}.svg) are ON-SCREEN APPEARANCE
// PREVIEWS, not flat artwork: each carries a baked squircle <clipPath> plus
// edge-highlight/specular gradients (measured: bg-light is a 200-point squircle
// clip over an #ECFF52→#DFFA04→#C2E000 plate; icon-light adds a radial specular
// and 12 stop-opacity stops). Rasterizing them would bake in exactly the
// rounded corners and gloss that iOS 26/27 applies at runtime — double-masking
// the corners and clipping the art. They are visual reference only.
//
// Geometry check: this script's plateSVG() at frac 0.74 computes
// `translate(133.12, 165.69) scale(0.74)`, which reproduces the committed
// Icon Composer foreground layer (vizion-icon-foreground-lime.svg:
// `translate(133.12, 165.66) scale(0.74)`) to 0.03 px at 1024² — i.e. the
// generated plates are the shipped artwork, not an approximation.
//
// RULES (never work around)
// -------------------------
//   • Full-bleed square. NO pre-rounded corners, NO gloss, NO drop shadow —
//     the OS rounds and glassifies at runtime.
//   • Maskable is the only padded exception: 0.58 glyph fraction so the art
//     clears Android's 80% safe-zone circle. Everything else uses 0.74.
//   • Alpha contract (guardrail §6 / INV-09, enforced by
//     tests/unit/icon-alpha.test.ts): the `any` matrix ships TRANSPARENT — the
//     glyph alone, no plate. maskable, apple-touch, the favicons and the App
//     Router icons ship OPAQUE, because iOS renders a transparent tile on
//     black and Android's mask has nothing to fill.
//   • public/brand/ is never written to. This script only reads from it.
//
// Idempotent: every output is overwritten on each run, so re-running yields
// the same tree.

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";

// Resolve paths relative to the repo root (this script lives in scripts/).
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const BRAND_DIR = path.join(repoRoot, "public", "brand");
const ICONS_DIR = path.join(repoRoot, "public", "icons");
const SPLASH_DIR = path.join(repoRoot, "public", "splash");
const APP_DIR = path.join(repoRoot, "src", "app");

const MASTER_SVG = path.join(BRAND_DIR, "vizion-glyph.svg");
const MANIFEST = path.join(repoRoot, "public", "manifest.webmanifest");

// Colors mirror the committed brand SVGs byte-for-byte — the artwork is locked,
// so these must not diverge. LASER is the glyph accent, VOID the dark plate
// (and the manifest's theme_color/background_color), INK the glyph on light.
const LASER = "#DFFA04";
const VOID = "#0F1012";
const INK = "#0F1012";

// Base appearance for the name-agnostic derivatives (favicons, apple-touch,
// App Router icons, maskable tiles). 'light' = Laser plate + Void ink, per the
// source spec. Flip to 'dark' (Void plate + Laser glyph) if the dark mark
// should ever become primary — one constant, nothing else to change.
const BASE = "light";

// Glyph fractions. 0.74 is the artwork's own composition (see the geometry
// check above); 0.58 pads the maskable tiles clear of the safe-zone circle.
const FRAC_STANDARD = 0.74;
const FRAC_MASKABLE = 0.58;

// The full transparent `any` matrix. The manifest references only 192/256/384/
// 512/1024; the intermediate sizes are the browser/OS-chrome tail and are
// asserted by tests/unit/icon-alpha.test.ts (which requires ≥13). Sizes are
// FROZEN — the manifest's `any` entries must stay a subset (asserted below).
const ANY_SIZES = [48, 72, 96, 128, 144, 152, 167, 180, 192, 256, 384, 512, 1024];

// iOS splash device classes (portrait, width × height in px). Each pairs with a
// media-qualified <link rel="apple-touch-startup-image"> in src/app/layout.tsx
// (PRI-007 / APPLE-01) — adding a size here without adding the link there ships
// a file nothing requests.
const SPLASH_SIZES = [
  [1290, 2796], // iPhone 15 Pro Max
  [1179, 2556], // iPhone 15 / 14 Pro
  [1170, 2532], // iPhone 13 / 14
  [1284, 2778], // iPhone 12/13 Pro Max
  [1125, 2436], // iPhone X / 11 Pro
  [828, 1792], // iPhone XR / 11
  [1242, 2688], // iPhone XS Max / 11 Pro Max
  [1536, 2048], // iPad
  [1668, 2388], // iPad Pro 11
  [2048, 2732], // iPad Pro 12.9
];

// Canvas the vector plates are authored at before sharp resamples to the target
// size. 1024 is the artwork's own canvas, so frac 0.74 lands on the committed
// Icon Composer transform exactly.
const CANVAS = 1024;

const written = [];

/** Void plate + Laser glyph, or Laser plate + Void ink. */
function appearance(name) {
  return name === "dark" ? { plate: VOID, glyph: LASER } : { plate: LASER, glyph: INK };
}

// ---------------------------------------------------------------------------
// Master glyph
// ---------------------------------------------------------------------------

const masterSource = await fs.readFile(MASTER_SVG, "utf8");

const viewBoxMatch = masterSource.match(/viewBox="([-\d.\s]+)"/);
if (!viewBoxMatch) throw new Error(`${MASTER_SVG}: missing viewBox`);
const [, , GLYPH_W, GLYPH_H] = viewBoxMatch[1].trim().split(/\s+/).map(Number);

const pathMatch = masterSource.match(/<path[^>]*\bd="([^"]+)"/);
if (!pathMatch) throw new Error(`${MASTER_SVG}: missing <path d>`);
const GLYPH_D = pathMatch[1];

/**
 * Place the glyph on a canvas: uniform scale so its width is `frac` of the
 * canvas width, horizontally centred, vertically centred with a slight optical
 * lift so the mark sits where the eye expects rather than where the maths puts
 * it. `lift` is a fraction of the canvas height (0 = true centre).
 */
function placeGlyph(canvasW, canvasH, frac, lift) {
  const scale = (canvasW * frac) / GLYPH_W;
  const w = GLYPH_W * scale;
  const h = GLYPH_H * scale;
  return {
    tx: (canvasW - w) / 2,
    ty: (canvasH - h) / 2 - lift * canvasH,
    scale,
  };
}

function glyphGroup(canvasW, canvasH, frac, fill, lift) {
  const { tx, ty, scale } = placeGlyph(canvasW, canvasH, frac, lift);
  return (
    `<g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${scale.toFixed(5)})">` +
    `<path d="${GLYPH_D}" fill="${fill}" fill-rule="evenodd"/></g>`
  );
}

/** Full-bleed opaque square: plate + glyph. No clip, no gloss, no shadow. */
function plateSVG({ plate, glyph }, frac, size = CANVAS) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" fill="${plate}"/>` +
    glyphGroup(size, size, frac, glyph, 0.0156) +
    `</svg>`
  );
}

/** Transparent square: the glyph alone, no plate (the `any` matrix). */
function glyphOnlySVG(fill, frac, size = CANVAS) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    glyphGroup(size, size, frac, fill, 0.0156) +
    `</svg>`
  );
}

/** Portrait splash: full-bleed plate with the glyph centred at `frac` width. */
function splashSVG({ plate, glyph }, width, height, frac) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${plate}"/>` +
    glyphGroup(width, height, frac, glyph, 0) +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// Raster helpers
// ---------------------------------------------------------------------------

function logWrite(outPath) {
  const rel = path.relative(repoRoot, outPath);
  written.push(rel);
  console.log(`  wrote ${rel}`);
}

/**
 * Rasterize an SVG string to PNG.
 *   • flatten: composite onto `background` so the result is provably opaque —
 *     a full-bleed <rect> alone can still leave sub-255 alpha on the outermost
 *     antialiased row, which tests/unit/icon-alpha.test.ts would fail.
 */
async function renderPng(svg, width, height, outPath, { flatten = null } = {}) {
  let pipe = sharp(Buffer.from(svg)).resize(width, height, { fit: "fill" });
  if (flatten) pipe = pipe.flatten({ background: flatten });
  await pipe.png({ compressionLevel: 9 }).toFile(outPath);
  logWrite(outPath);
}

/**
 * Pack already-rendered square PNGs into a .ico container (ICONDIR + one
 * ICONDIRENTRY per image + the PNG blobs verbatim). PNG-compressed entries
 * have been valid ICO members since Vista and are what every browser expects.
 * Hand-rolled on purpose: it is ~25 lines against sharp, which the repo already
 * depends on, and CI runs a blocking full-tree `npm audit` — a dedicated ICO
 * dependency would add supply-chain surface for nothing.
 */
async function writeFaviconIco(pngPaths, outPath) {
  const pngs = await Promise.all(pngPaths.map((p) => fs.readFile(p)));
  const sizes = await Promise.all(
    pngPaths.map(async (p) => (await sharp(p).metadata()).width),
  );
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (let i = 0; i < pngs.length; i++) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 0); // width (0 = 256)
    entry.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 1); // height
    entry.writeUInt8(0, 2); // palette size (none)
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(pngs[i].length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += pngs[i].length;
  }
  await fs.writeFile(outPath, Buffer.concat([header, ...entries, ...pngs]));
  logWrite(outPath);
}

// ---------------------------------------------------------------------------
// Reference surfaces
// ---------------------------------------------------------------------------

/**
 * Read the PWA icon inventory straight out of public/manifest.webmanifest, so
 * filenames and sizes can never drift from what the manifest declares. There is
 * no index.html in this repo — the <head> is owned by src/app/layout.tsx plus
 * the App Router convention files (icon0.svg / icon1.png / apple-icon.png),
 * which are generated explicitly in main().
 */
async function readManifestIcons() {
  const manifest = JSON.parse(await fs.readFile(MANIFEST, "utf8"));
  const any = [];
  const maskable = [];
  for (const icon of manifest.icons ?? []) {
    if (!icon.src || !/\.png$/i.test(icon.src)) continue;
    const px = Math.max(
      ...(String(icon.sizes || "").match(/(\d+)x\1/g) ?? ["512x512"]).map((s) =>
        parseInt(s, 10),
      ),
    );
    const file = path.join(repoRoot, "public", icon.src.replace(/^\//, ""));
    (/maskable/i.test(icon.purpose || "") ? maskable : any).push({ file, px });
  }
  return { any, maskable };
}

// ---------------------------------------------------------------------------

async function main() {
  await Promise.all(
    [ICONS_DIR, SPLASH_DIR, APP_DIR].map((dir) => fs.mkdir(dir, { recursive: true })),
  );

  const { any: manifestAny, maskable: manifestMaskable } = await readManifestIcons();

  // The manifest's `any` entries must be a subset of the frozen matrix — if the
  // manifest ever gains a size this script does not render, fail loudly here
  // rather than shipping a 404 in the install prompt.
  const missing = manifestAny
    .filter(({ px }) => !ANY_SIZES.includes(px))
    .map(({ px }) => px);
  if (missing.length) {
    throw new Error(
      `manifest.webmanifest declares any-purpose size(s) ${missing.join(", ")} ` +
        `not present in ANY_SIZES — add them to the frozen matrix.`,
    );
  }

  // 1. Transparent `any` matrix: the glyph alone in Laser, no plate. Laser (not
  //    Void ink) because there is no plate behind it here — this is the same
  //    colorway as the committed vizion-icon-foreground-lime.svg layer, and it
  //    stays legible on whatever ground the consumer paints.
  console.log("Rendering transparent 'any' icons...");
  for (const size of ANY_SIZES) {
    const svg = glyphOnlySVG(LASER, FRAC_STANDARD);
    await renderPng(svg, size, size, path.join(ICONS_DIR, `icon-${size}.png`));
  }

  // 2. Maskable set: opaque full-bleed plate, glyph padded to 0.58 so nothing
  //    crosses Android's 80% safe-zone circle. Sizes come from the manifest.
  console.log("Rendering maskable icons...");
  const maskableSvg = plateSVG(appearance(BASE), FRAC_MASKABLE);
  const maskablePlate = appearance(BASE).plate;
  for (const { file, px } of manifestMaskable) {
    await renderPng(maskableSvg, px, px, file, { flatten: maskablePlate });
  }

  // 3. apple-touch-icon (opaque branded tile — iOS ignores transparency and
  //    would composite a transparent tile onto black).
  console.log("Rendering apple-touch-icon...");
  const baseSvg = plateSVG(appearance(BASE), FRAC_STANDARD);
  const basePlate = appearance(BASE).plate;
  await renderPng(baseSvg, 180, 180, path.join(ICONS_DIR, "apple-touch-icon.png"), {
    flatten: basePlate,
  });

  // 4. Favicon PNGs (a plated tile reads better than a bare mark at 16px).
  console.log("Rendering favicons...");
  for (const size of [16, 32, 48]) {
    await renderPng(baseSvg, size, size, path.join(ICONS_DIR, `favicon-${size}.png`), {
      flatten: basePlate,
    });
  }
  // Also assemble /favicon.ico from those PNGs: browsers (and the offline 404
  // console) still request the legacy path unconditionally, and App Router's
  // <link rel="icon"> does not cover it.
  await writeFaviconIco(
    [16, 32, 48].map((size) => path.join(ICONS_DIR, `favicon-${size}.png`)),
    path.join(repoRoot, "public", "favicon.ico"),
  );

  // 5. Next.js App Router auto-wired icons:
  //    • icon0.svg  — scalable favicon (preferred by modern browsers)
  //    • icon1.png  — raster fallback
  //    • apple-icon.png — home-screen tile
  // NUMBERED names, not icon.svg + icon.png: with both unnumbered files Next
  // emitted a link for the PNG only, so the SVG was generated and served but
  // never referenced by any tag (audit VAR-15). The numbered convention makes
  // Next link both, SVG first.
  //
  // icon0.svg is the generated flat plate, NOT a copy of a public/brand file —
  // the composed brand SVGs carry the baked squircle + gloss this pipeline
  // forbids, and a favicon must be the same full-bleed square as its raster
  // siblings.
  console.log("Rendering Next.js App Router icons...");
  await fs.writeFile(path.join(APP_DIR, "icon0.svg"), `${baseSvg}\n`);
  logWrite(path.join(APP_DIR, "icon0.svg"));
  await renderPng(baseSvg, 512, 512, path.join(APP_DIR, "icon1.png"), {
    flatten: basePlate,
  });
  await renderPng(baseSvg, 180, 180, path.join(APP_DIR, "apple-icon.png"), {
    flatten: basePlate,
  });

  // 6. iOS splash screens. Dark appearance (Void plate + Laser glyph) so the
  //    launch image matches the manifest's background_color #0F1012 — a Laser
  //    plate here would flash full-bleed lime before the app paints. Glyph at
  //    30% of the device width, optically centred.
  console.log("Rendering iOS splash screens...");
  const splashApp = appearance("dark");
  for (const [width, height] of SPLASH_SIZES) {
    const svg = splashSVG(splashApp, width, height, 0.3);
    await renderPng(
      svg,
      width,
      height,
      path.join(SPLASH_DIR, `splash-${width}x${height}.png`),
      {
        flatten: splashApp.plate,
      },
    );
  }

  console.log(`\nDone. ${written.length} files written.`);
}

main().catch((err) => {
  console.error("generate-icons failed:", err);
  process.exit(1);
});

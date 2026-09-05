// VIZION PWA icon + splash generator.
//
// Renders the full brand asset matrix (the transparent `any` icons, the
// maskable tiles, the apple-touch tile, the scalable icon, the raster favicons
// and favicon.ico, and the iOS splash screens) from ONE master SVG using sharp.
// Run with: node scripts/generate-icons.mjs
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
//     composed from, painted here with the colorways below.
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
// Geometry check: this script's placeGlyph() at frac 0.74 computes
// `translate(133.12, 165.69) scale(0.74)`, which reproduces the committed
// Icon Composer foreground layer (vizion-icon-foreground-lime.svg:
// `translate(133.12, 165.66) scale(0.74)`) to 0.03 px at 1024² — i.e. the
// generated tiles are the shipped artwork, not an approximation.
//
// INSTALLED ARTWORK AND SOURCE SELECTION (ADR-0017, Amendment 5)
// -----------------------------------------------------------------------
// The installed tiles (the Apple tile, the maskable tiles, the adaptive SVG's
// light branch) are INVERTED: a flat plate in the light theme's --accent-ink
// (the deep green the in-app mark wears on light surfaces) and the flat Laser
// mark on it, with NO outline. iOS derives the Dark Home Screen tile by
// segmenting the foreground from the flat plate and keeping it (owner
// screenshots 2026-08-11 and 2026-09-05), so what it keeps is the full-Laser
// mark on its own near-black plate; in Light the Laser mark reads on the
// deep green plate at ~5:1, and the tile, the header mark and every other
// light-surface use of the brand green are one token. The transparent `any` PNGs
// keep the OUTLINED mark — Laser fill, Void stroke — because a launcher paints
// its own ground behind them and the outline is what carries a Laser mark on
// a light one. This supplies contrast on authored light and dark grounds, not
// a guarantee about every undocumented system transformation.
//
// Production deliberately declares one unconditional apple-touch-icon PNG.
// WebKit documents that this takes precedence over manifest icons on iOS.
// The SVG remains useful to SVG-aware consumers; array order does not make
// it the installed iPhone source. Safari 26's SVG icon support does not by
// itself prove live re-evaluation after installation. Keep that question in
// the isolated diagnostic, not in production source-selection experiments.
// See docs/runbooks/icon-install-repair.md for sources and device acceptance.
//
// RULES (never work around)
// -------------------------
//   • Full-bleed square. NO pre-rounded corners, NO specular gloss, NO drop
//     shadow — the OS rounds and glassifies at runtime. Both the PLATE and
//     the MARK are flat: iOS segments the mark from the plate by colour, and
//     a ramp on either side only blurs that edge (owner decision 2026-09-05).
//   • Maskable is the only padded exception: 0.58 glyph fraction so the art
//     clears Android's 80% safe-zone circle. Everything else uses 0.74.
//   • Alpha contract (guardrail §6 / INV-09, enforced by
//     tests/unit/icon-alpha.test.ts): the `any` matrix ships TRANSPARENT — the
//     outlined mark alone, no plate. maskable, the apple-touch tile and the
//     favicons ship OPAQUE, because iOS renders a transparent tile on black and
//     Android's mask has nothing to fill.
//   • The favicons and favicon.ico keep the FLAT house colorway (Void ink on a
//     Laser plate). At 16–48 px a 4 px outline is sub-pixel, and the flat mark
//     is the crisper small-size rendition of the same identity. They are the
//     browser tab, not an install surface.
//   • public/brand/ is never written to. This script only reads from it.
//
// EVERY OUTPUT LANDS UNDER public/. There are no `src/app/` convention icons
// (icon0.svg / icon1.png / apple-icon.png) any more. The reason is Next's
// all-or-nothing merge, not the `media` attribute the head once needed: the
// convention links are folded in only `if (!resolvedMetadata.icons)`
// (resolve-metadata.js), so the moment a layout exports `metadata.icons` they
// vanish. src/app/layout.tsx declares the whole icon head itself, and the
// convention files were deleted rather than left to be built, served and
// referenced by nothing.
//
// Idempotent: every output is overwritten on each run, so re-running yields
// the same tree.

import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";

// Resolve paths relative to the repo root (this script lives in scripts/).
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const BRAND_DIR = path.join(repoRoot, "public", "brand");
export const ICONS_DIR = path.join(repoRoot, "public", "icons");
const SPLASH_DIR = path.join(repoRoot, "public", "splash");

const MASTER_SVG = path.join(BRAND_DIR, "vizion-glyph.svg");
const MANIFEST = path.join(repoRoot, "public", "manifest.webmanifest");
const TOKENS = path.join(repoRoot, "src", "styles", "tokens.css");

/**
 * Read a token's hex straight out of `src/styles/tokens.css`.
 *
 * The colours are NOT restated here. `tasks/lessons.md` records the failure
 * that follows from restating them — icon art authored beside the token file
 * instead of from it, drifting a full hue band before anyone noticed, because
 * nothing connected the two. A literal in this script would be that same
 * disconnection with a shorter fuse: it would agree with `tokens.css` exactly
 * until the day someone retunes one and not the other.
 *
 * So the generator derives. Retune `--laser`, re-run `npm run generate:icons`,
 * and every derivative follows by construction — the icons cannot disagree
 * with the design system about what the brand green is.
 *
 * `token()` reads the DARK-block values (the first match), which is most of the
 * palette this pipeline needs: an app icon has no theme, it has an appearance.
 * `lightToken()` reads the `:root[data-theme="light"]` block, for the one
 * colour that IS theme-specific by construction: --accent-ink, the deep green
 * the in-app mark wears on light surfaces (BrandMark paints `currentColor`
 * from it). The installed tile's plate is that token, so the Home Screen tile
 * and the header mark cannot disagree about what the brand green looks like
 * on a light ground.
 */
const tokensCss = await fs.readFile(TOKENS, "utf8");
function token(name) {
  const m = tokensCss.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!m) throw new Error(`tokens.css: --${name} not found (or is not a hex)`);
  return m[1].toUpperCase();
}
function lightToken(name) {
  const block = tokensCss.match(/:root\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/);
  if (!block) throw new Error('tokens.css: :root[data-theme="light"] block not found');
  const m = block[1].match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!m) throw new Error(`tokens.css: --${name} not found in the light theme block`);
  return m[1].toUpperCase();
}

// LASER is the brand green — the installed mark, and the favicons' plate; VOID
// the dark plate of the splash screens (and the manifest's theme_color/
// background_color); INK the dark ink on a Laser plate — the favicons' mark and
// the `any` matrix's stroke; ACCENT_INK_LIGHT the deep green the brand wears on
// light surfaces — the installed tile's plate.
const LASER = token("laser");
const VOID = token("void");
const INK = VOID;
const ACCENT_INK_LIGHT = lightToken("accent-ink");

// Appearance for the FLAT derivatives that keep it — the favicons. 'light' =
// Laser plate + Void ink, the house colorway.
const BASE = "light";

// ---------------------------------------------------------------------------
// The OUTLINED colorway — what gets installed
// ---------------------------------------------------------------------------

/** `#RRGGBB` → [r, g, b]. */
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/** [r, g, b] → `#RRGGBB`, clamped and rounded. */
function rgbToHex(rgb) {
  return (
    "#" +
    rgb
      .map((v) =>
        Math.round(Math.min(255, Math.max(0, v)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
      .toUpperCase()
  );
}

/** Linear sRGB mix of `a` toward `b` by `t` (0 = a, 1 = b). */
function mix(a, b, t) {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  return rgbToHex(ra.map((v, i) => v + (rb[i] - v) * t));
}

/**
 * The installed tile is INVERTED: the PLATE is the light theme's --accent-ink
 * and the MARK is the Laser token, both flat. iOS derives the Dark Home
 * Screen tile by segmenting the foreground from the flat plate and keeping
 * it — a mark whose colour matches the plate is discarded with it (owner
 * screenshots 2026-09-05: the Laser-filled outlined mark on a Laser plate was
 * only dimmed; a mark shaded away from the plate was kept). Inverting puts the
 * FULL-Laser mark on iOS's near-black plate in Dark (≈16:1) and on the deep
 * green plate in Light (≈5:1). An ad-hoc 0.55 mix toward Void was the first
 * cut (ADR-0017 Amendment 5); the owner replaced it with the token the header
 * mark already wears on light surfaces, so the two are one colour by
 * construction (Amendment 6). `plateDarkTop` is the adaptive SVG's dark plate
 * lift only.
 */
const LIGHTING = { plateDarkTop: 0.05 };

/**
 * The outline's stroke width in GLYPH units. The stroke is painted UNDER the
 * fill, so only its outer half is visible: 60 units → a 30-unit outline, which
 * at the 0.74 tile fraction is 22 px on the 1024 canvas and ~4 px on the 180 px
 * apple-touch tile. Every interior gap in the mark (bar ↔ ring ≈ 20 units,
 * chevron ↔ ring ≈ 25) is narrower than twice this, so the gaps fill solid and
 * the shapes stay separated by a line rather than a sliver of plate.
 */
export const OUTLINE_WIDTH = 60;

/**
 * The installed colorway's colours, every one derived from the tokens so the
 * tests can import them instead of restating a hex. `mark` IS the Laser token;
 * `plate` IS the light theme's --accent-ink; `outline` is the Void stroke that
 * only the transparent `any` matrix still carries.
 */
export function installedColorway() {
  return {
    plate: ACCENT_INK_LIGHT,
    mark: LASER,
    outline: INK,
    // The dark appearance's plate, for the scalable icon only (below): the Void
    // token with a whisper of lift at the top, so it reads as a plate rather
    // than a hole — the same shape the Icon Composer dark background takes.
    plateDarkTop: mix(VOID, "#FFFFFF", LIGHTING.plateDarkTop),
    plateDarkBottom: VOID,
  };
}

// Glyph fractions. 0.74 is the artwork's own composition (see the geometry
// check above); 0.58 pads the maskable tiles clear of the safe-zone circle.
const FRAC_STANDARD = 0.74;
const FRAC_MASKABLE = 0.58;

// The full transparent `any` matrix. The manifest references only 192/256/384/
// 512/1024; the intermediate sizes are the browser/OS-chrome tail and are
// asserted by tests/unit/icon-alpha.test.ts (which requires ≥13). Sizes are
// FROZEN — the manifest's `any` entries must stay a subset (asserted below).
export const ANY_SIZES = [48, 72, 96, 128, 144, 152, 167, 180, 192, 256, 384, 512, 1024];

// The scalable icon's frozen filename. Named once, read by BOTH the writer in
// main() and assertScalableEntries, so the manifest and the file on disk cannot
// drift apart the way a restated literal would let them.
export const SCALABLE_ICON = "app-icon.svg";

// THE home-screen tile's frozen filename — one file, no appearance suffix. It
// used to be `apple-touch-icon-dark.png`, named for the Void colorway it
// carried; the outlined colorway is neither light nor dark, and a file named
// for a colorway it no longer carries is the exact confusion the earlier
// naming saga existed to prevent. Read by main() and by src/app/layout.tsx's
// `metadata.icons.apple` (a literal there, pinned by the e2e head test, plus a
// `?v=` content version next.config.ts hashes from this file at build so a
// regenerated tile is a new URL to every cache on the phone).
export const APPLE_TOUCH_ICON = "apple-touch-icon.png";

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

// Canvas the vector tiles are authored at before sharp resamples to the target
// size. 1024 is the artwork's own canvas, so frac 0.74 lands on the committed
// Icon Composer transform exactly.
const CANVAS = 1024;

const written = [];

/** Void plate + Laser glyph, or Laser plate + Void ink — the flat colorways. */
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

function transformFor(canvasW, canvasH, frac, lift) {
  const { tx, ty, scale } = placeGlyph(canvasW, canvasH, frac, lift);
  return `translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${scale.toFixed(5)})`;
}

/** The flat mark: one path, one fill. */
function glyphGroup(canvasW, canvasH, frac, fill, lift) {
  return (
    `<g transform="${transformFor(canvasW, canvasH, frac, lift)}">` +
    `<path d="${GLYPH_D}" fill="${fill}" fill-rule="evenodd"/></g>`
  );
}

/**
 * The OUTLINED mark (the transparent `any` matrix only): the same path twice,
 * stroke first, fill on top.
 *
 * Two paths rather than `paint-order="stroke"` on one, deliberately. sharp's
 * librsvg renders the two identically (measured, byte-for-byte), and so does
 * every browser that will ever paint app-icon.svg — but a stroke painted under
 * a fill is SVG 1.1 and needs no renderer to know a property. A renderer that
 * dropped `paint-order` would centre the stroke on the edge instead and eat
 * half the outline out of the fill's thinnest features (the ring is ~65 glyph
 * units where the stroke is 60). Two paths cannot degrade that way.
 *
 * Round joins: the chevron's tips are acute, and a mitred outline would spike
 * well past them.
 */
function outlinedMark(canvasW, canvasH, frac, lift) {
  const { outline, mark } = installedColorway();
  return (
    `<g transform="${transformFor(canvasW, canvasH, frac, lift)}">` +
    `<path d="${GLYPH_D}" fill="none" stroke="${outline}" stroke-width="${OUTLINE_WIDTH}" ` +
    `stroke-linejoin="round" stroke-linecap="round"/>` +
    `<path d="${GLYPH_D}" fill="${mark}" fill-rule="evenodd"/></g>`
  );
}

/**
 * Full-bleed opaque square in the INSTALLED colorway: the accent-ink plate and the
 * flat Laser mark, no outline — the Apple tile and the maskable tiles.
 */
function installedTileSVG(frac, size = CANVAS) {
  const c = installedColorway();
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" fill="${c.plate}"/>` +
    glyphGroup(size, size, frac, c.mark, 0.0156) +
    `</svg>`
  );
}

/** Transparent square: the outlined mark alone, no plate (the `any` matrix). */
function outlinedGlyphSVG(frac, size = CANVAS) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    outlinedMark(size, size, frac, 0.0156) +
    `</svg>`
  );
}
/**
 * Adaptive SVG for consumers that select and render it. This is not proof
 * that an installed iPhone icon is live SVG: the explicit Apple PNG wins
 * under WebKit's documented manifest precedence.
 *
 * The light plate is both a presentation attribute and a stylesheet rule.
 * SVG presentation attributes have specificity zero, so the .plate class
 * overrides that fallback, including the dark media rule. Do not use an
 * inline style here: that would interfere with the class-based override.
 * With the stylesheet absent the plate is still the deep green, not SVG's
 * default black. A stripped-style fixture tests resilience, not an iOS
 * algorithm.
 *
 * The canonical mark — flat Laser, no outline — is unchanged in both modes;
 * only the plate swaps. color-scheme advertises supported schemes;
 * prefers-color-scheme selects the override when the consuming renderer
 * evaluates the query.
 */
function scalableIconSVG(frac, size = CANVAS) {
  const c = installedColorway();
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<style>` +
    `:root{color-scheme:light dark}` +
    `.plate{fill:${c.plate}}` +
    `@media (prefers-color-scheme:dark){.plate{fill:url(#plate-dark)}}` +
    `</style>` +
    `<defs>` +
    `<linearGradient id="plate-dark" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${c.plateDarkTop}"/>` +
    `<stop offset="1" stop-color="${c.plateDarkBottom}"/></linearGradient>` +
    `</defs>` +
    `<rect class="plate" width="${size}" height="${size}" fill="${c.plate}"/>` +
    glyphGroup(size, size, frac, c.mark, 0.0156) +
    `</svg>`
  );
}

/** Full-bleed opaque square in a FLAT colorway: plate + glyph. No clip, no
 *  gloss, no shadow. The favicons. */
function plateSVG({ plate, glyph }, frac, size = CANVAS) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" fill="${plate}"/>` +
    glyphGroup(size, size, frac, glyph, 0.0156) +
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
 *     antialiased row, which tests/unit/icon-alpha.test.ts would fail. For a
 *     gradient plate the colour only ever reaches that one row, so the base
 *     token is the right backing.
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
 * no index.html in this repo — the <head> is owned entirely by
 * src/app/layout.tsx's `metadata.icons`, whose hrefs point at the favicon and
 * apple-touch files main() writes below.
 */
async function readManifestIcons() {
  const manifest = JSON.parse(await fs.readFile(MANIFEST, "utf8"));
  const any = [];
  const maskable = [];
  const scalable = [];
  for (const icon of manifest.icons ?? []) {
    if (!icon.src) continue;
    // SVG entries carry no pixel size, so they cannot go through the size-based
    // matrix check below — they get their own guard (assertScalableEntries).
    // Collected rather than skipped: an unvalidated manifest entry is exactly
    // the silent 404 the `any` guard was written for (Codex review, PR #105),
    // and leaving `continue` here would have reopened it for the SVG.
    if (/\.svg$/i.test(icon.src)) {
      scalable.push({
        src: icon.src,
        file: path.join(repoRoot, "public", icon.src.replace(/^\//, "")),
      });
      continue;
    }
    if (!/\.png$/i.test(icon.src)) continue;
    const px = Math.max(
      ...(String(icon.sizes || "").match(/(\d+)x\1/g) ?? ["512x512"]).map((s) =>
        parseInt(s, 10),
      ),
    );
    const file = path.join(repoRoot, "public", icon.src.replace(/^\//, ""));
    // `src` is carried alongside `file` so a validation failure can quote the
    // manifest line the author actually wrote, not a resolved absolute path.
    (/maskable/i.test(icon.purpose || "") ? maskable : any).push({
      src: icon.src,
      file,
      px,
    });
  }
  return { any, maskable, scalable };
}

/**
 * Assert every SVG manifest entry names the scalable icon this generator
 * actually writes.
 *
 * Same failure this file's `any` guard exists for, in the one shape that guard
 * cannot see: it keys on pixel size, and an SVG has none, so before this the
 * manifest could name `/icons/anything.svg` and nothing would notice. The
 * generator would write `app-icon.svg` as always and the manifest would point at
 * a file that does not exist — a silent 404 in the install prompt, which for the
 * SCALABLE entry is worse than for a raster one, because it is declared first
 * and is the entry a modern consumer reaches for before any PNG.
 */
export function assertScalableEntries(entries, iconsDir) {
  const expected = path.join(iconsDir, SCALABLE_ICON);
  const problems = entries
    .filter(({ file }) => file !== expected)
    .map(
      ({ src }) =>
        `  ${src} — the scalable icon is generated at a frozen path; expected ` +
        `/icons/${SCALABLE_ICON}. Rename it back, or teach this script the new name.`,
    );
  if (problems.length) {
    throw new Error(
      `manifest.webmanifest declares SVG icons this generator does not ` +
        `produce:\n${problems.join("\n")}`,
    );
  }
}

/**
 * Assert every `any`-purpose manifest entry is one this generator actually
 * writes — BOTH its size and its path.
 *
 * Why this is a validation and not, as the maskable branch does, a loop over the
 * manifest's own paths: the `any` matrix is a SUPERSET of the manifest. Thirteen
 * sizes are rendered, five are declared; the other eight are the browser/OS
 * chrome tail that tests/unit/icon-alpha.test.ts requires. It therefore cannot
 * be driven by the manifest alone — the frozen filenames are the source, and the
 * manifest has to agree with them. The maskable set IS exactly the manifest set,
 * so it can be manifest-driven, and is.
 *
 * Checking size alone was not enough (Codex review, PR #105): renaming a
 * declared entry to a still-supported size — `/icons/icon-192.png` →
 * `/icons/app-192.png` — passed, this script wrote `icon-192.png` as always, and
 * the manifest was left pointing at a file nothing creates. That is a 404 in the
 * install prompt, arriving silently, which is precisely what the guard claims to
 * prevent. Names are frozen (see the header), so a rename is an error to report,
 * never something to quietly absorb.
 */
export function assertAnyEntriesMatchMatrix(entries, sizes, iconsDir) {
  const problems = [];
  for (const { src, file, px } of entries) {
    if (!sizes.includes(px)) {
      problems.push(
        `  ${src} — size ${px} is not in ANY_SIZES; add it to the frozen matrix ` +
          `or correct the manifest.`,
      );
      continue;
    }
    const expected = path.join(iconsDir, `icon-${px}.png`);
    if (file !== expected) {
      problems.push(
        `  ${src} — the any matrix is generated at frozen paths; expected ` +
          `/icons/icon-${px}.png. Rename it back, or teach this script the new name.`,
      );
    }
  }
  if (problems.length) {
    throw new Error(
      `manifest.webmanifest declares any-purpose icons this generator does not ` +
        `produce:\n${problems.join("\n")}`,
    );
  }
}

// ---------------------------------------------------------------------------

async function main() {
  await Promise.all(
    [ICONS_DIR, SPLASH_DIR].map((dir) => fs.mkdir(dir, { recursive: true })),
  );

  const {
    any: manifestAny,
    maskable: manifestMaskable,
    scalable: manifestScalable,
  } = await readManifestIcons();

  // Every declared entry must name a file this script actually writes. Fail
  // loudly here rather than shipping a 404 in the install prompt — by size AND
  // path for the raster matrix, by path for the scalable icon (which has no
  // size to key on, and so needs its own guard).
  assertAnyEntriesMatchMatrix(manifestAny, ANY_SIZES, ICONS_DIR);
  assertScalableEntries(manifestScalable, ICONS_DIR);

  // 1. Transparent `any` matrix: the outlined mark alone, no plate. A consumer
  //    paints its own ground behind an `any` icon, and the outline is what
  //    makes the mark legible on whichever ground that turns out to be — the
  //    bare Laser glyph this used to be was a 1.3:1 smear on a light launcher.
  console.log("Rendering transparent 'any' icons...");
  for (const size of ANY_SIZES) {
    const svg = outlinedGlyphSVG(FRAC_STANDARD);
    await renderPng(svg, size, size, path.join(ICONS_DIR, `icon-${size}.png`));
  }

  // 2. Maskable set: opaque full-bleed installed tile, mark padded to 0.58 so
  //    nothing crosses Android's 80% safe-zone circle. Sizes come from the
  //    manifest.
  console.log("Rendering maskable icons...");
  const tilePlate = installedColorway().plate;
  const maskableSvg = installedTileSVG(FRAC_MASKABLE);
  for (const { file, px } of manifestMaskable) {
    await renderPng(maskableSvg, px, px, file, { flatten: tilePlate });
  }

  // 3. THE apple-touch-icon — one tile, the installed colorway. Opaque: iOS
  //    composites a transparent tile onto black. See the header for why there
  //    is one, why it carries no appearance suffix, and what is and is not
  //    known about how iOS will treat it.
  console.log("Rendering the apple-touch-icon...");
  await renderPng(
    installedTileSVG(FRAC_STANDARD),
    180,
    180,
    path.join(ICONS_DIR, APPLE_TOUCH_ICON),
    { flatten: tilePlate },
  );

  // 4. Favicon PNGs — the FLAT house colorway (a plated flat tile reads better
  //    than an outlined one at 16px; see the rules above).
  console.log("Rendering favicons...");
  const baseSvg = plateSVG(appearance(BASE), FRAC_STANDARD);
  const basePlate = appearance(BASE).plate;
  for (const size of [16, 32, 48]) {
    await renderPng(baseSvg, size, size, path.join(ICONS_DIR, `favicon-${size}.png`), {
      flatten: basePlate,
    });
  }
  // Also assemble /favicon.ico from those PNGs: browsers (and the offline 404
  // console) still request the legacy root path unconditionally, and no
  // <link rel="icon"> covers it.
  await writeFaviconIco(
    [16, 32, 48].map((size) => path.join(ICONS_DIR, `favicon-${size}.png`)),
    path.join(repoRoot, "public", "favicon.ico"),
  );

  // 5. Adaptive SVG for the manifest and rel="icon" consumers. The explicit
  //    Apple touch PNG is the deliberate production iOS candidate, not a
  //    fallback to this SVG. The isolated harness tests the alternative.
  //    Generate from the master, not the composed, pre-rounded brand previews.
  console.log("Rendering the scalable icon (both appearances)...");
  await fs.writeFile(
    path.join(ICONS_DIR, SCALABLE_ICON),
    `${scalableIconSVG(FRAC_STANDARD)}\n`,
  );
  logWrite(path.join(ICONS_DIR, SCALABLE_ICON));

  // 6. iOS splash screens. Dark appearance (Void plate + Laser glyph) so the
  //    launch image matches the manifest's background_color #0F1012 — a Laser
  //    plate here would flash full-bleed lime before the app paints. Glyph at
  //    30% of the device width, optically centred. Flat, not outlined: this is
  //    a launch screen on a known ground, not an icon on an unknown one.
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

// Generate only when invoked directly — `node scripts/generate-icons.mjs`, and
// so `npm run generate:icons` and the CI step that calls it. The module is also
// IMPORTED, by tests/unit/generate-icons-guard.test.ts and
// tests/unit/app-icon-svg.test.ts, to reach the validators and the colorway
// above; without this check that import would rewrite 31 files as a side
// effect of running the test suite.
//
// If this guard ever evaluates false under the CLI, generation silently stops
// while every unit test stays green. What catches that is CI's "the generated
// tree is committed and reproducible" step, which diffs public/ after running
// this script. There is deliberately NO unit test for it: a test cannot re-run
// a generator that writes to fixed paths without either clobbering the working
// tree or reimplementing the whole pipeline. (An earlier revision of this
// comment claimed such a test existed. It never did.)
const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error("generate-icons failed:", err);
    process.exit(1);
  });
}

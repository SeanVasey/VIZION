// VIZ(IO)N PWA icon + splash generator.
//
// Renders the full brand asset matrix (icons, maskable tiles, apple-touch-icon,
// Next.js App Router favicons, and iOS splash screens) from the master brand
// SVGs using sharp. Run with: node scripts/generate-icons.mjs
//
// Sources (master, hand-authored artwork — see public/brand/):
//   • vizion-icon-token.svg — the full app icon: a glossy near-black squircle
//     with a laser-green glowing border framing the I›O mark (bar, chevron and
//     split ring). Used for opaque surfaces: apple-touch-icon, favicons, and
//     the App Router icon/apple-icon.
//   • vizion-mark-token.svg — the I›O mark ALONE (laser-green bar, chevron and
//     split ring) on a transparent ground. Used for the transparent "any" PWA
//     matrix, the maskable safe zone, and the iOS splash glyph.
//
// Idempotent: every output is overwritten on each run.

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

const ICON_SVG = path.join(BRAND_DIR, "vizion-icon-token.svg");
const MARK_SVG = path.join(BRAND_DIR, "vizion-mark-token.svg");

// Transparent fill for the "any" purpose PNGs.
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
// Void background (style-guide §1.1) for opaque tiles + splashes.
const VOID = "#0F1012";

// Sizes for the transparent "any" icon matrix.
const ANY_SIZES = [48, 72, 96, 128, 144, 152, 167, 180, 192, 256, 384, 512, 1024];

// iOS splash device classes (portrait, width x height in px).
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

const written = [];

// Render an SVG buffer to a square PNG.
//   • flatten=false → preserve transparency (the "any" matrix, mark-only).
//   • flatten=true  → composite onto Void so transparent corners read opaque
//     (apple-touch / favicons, where the OS expects a filled square).
async function renderSquarePng(svgBuffer, size, outPath, { flatten = false } = {}) {
  let pipe = sharp(svgBuffer, { density: 384 }).resize(size, size, {
    fit: "contain",
    background: TRANSPARENT,
  });
  if (flatten) pipe = pipe.flatten({ background: VOID });
  await pipe.png().toFile(outPath);
  logWrite(outPath);
}

// Pack already-rendered square PNGs into a .ico container (ICONDIR + one
// ICONDIRENTRY per image + the PNG blobs verbatim). PNG-compressed entries
// have been valid ICO members since Vista and are what every browser expects.
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

// Composite the transparent mark, centered, onto a Void canvas of WxH. Used for
// the maskable safe zone (square) and the iOS splash screens (portrait).
async function renderMarkOnVoid(markBuffer, width, height, markSize, outPath) {
  const mark = await sharp(markBuffer, { density: 384 })
    .resize(markSize, markSize, { fit: "contain", background: TRANSPARENT })
    .png()
    .toBuffer();

  await sharp({
    create: { width, height, channels: 4, background: VOID },
  })
    .composite([{ input: mark, gravity: "centre" }])
    .png()
    .toFile(outPath);
  logWrite(outPath);
}

function logWrite(outPath) {
  const rel = path.relative(repoRoot, outPath);
  written.push(rel);
  console.log(`  wrote ${rel}`);
}

async function main() {
  // Load the master artwork once.
  const [iconSvg, markSvg] = await Promise.all([
    fs.readFile(ICON_SVG),
    fs.readFile(MARK_SVG),
  ]);

  // Ensure output directories exist.
  await fs.mkdir(ICONS_DIR, { recursive: true });
  await fs.mkdir(SPLASH_DIR, { recursive: true });
  await fs.mkdir(APP_DIR, { recursive: true });

  // 1. Transparent "any" icon matrix (mark alone, no plate).
  console.log("Rendering transparent 'any' icons...");
  for (const size of ANY_SIZES) {
    const out = path.join(ICONS_DIR, `icon-${size}.png`);
    await renderSquarePng(markSvg, size, out);
  }

  // 2. Maskable set: mark centered on a full-bleed Void canvas, sized so the
  //    art's corners stay inside the Android maskable safe circle — the
  //    rendered corner radius must stay ≤ 0.40 × size. With fit: "contain" and
  //    the 1560×987 (1.581:1) mark, a 0.68 bounding box puts the corners at
  //    ≈0.40 × size from centre; anything larger gets clipped by the mask.
  console.log("Rendering maskable icons...");
  for (const size of [192, 512]) {
    const out = path.join(ICONS_DIR, `maskable-${size}.png`);
    await renderMarkOnVoid(markSvg, size, size, Math.round(size * 0.68), out);
  }

  // 3. apple-touch-icon (opaque branded tile — iOS ignores transparency).
  console.log("Rendering apple-touch-icon...");
  await renderSquarePng(iconSvg, 180, path.join(ICONS_DIR, "apple-touch-icon.png"), {
    flatten: true,
  });

  // 4. Favicon PNGs (branded tile reads better than a bare mark at small sizes).
  console.log("Rendering favicons...");
  for (const size of [16, 32, 48]) {
    const out = path.join(ICONS_DIR, `favicon-${size}.png`);
    await renderSquarePng(iconSvg, size, out, { flatten: true });
  }
  // Also assemble /favicon.ico from those PNGs: browsers (and the offline 404
  // console) still request the legacy path unconditionally, and App Router's
  // <link rel="icon"> does not cover it. PNG-in-ICO container — fine for every
  // consumer of this path, which is browsers only.
  await writeFaviconIco(
    [16, 32, 48].map((size) => path.join(ICONS_DIR, `favicon-${size}.png`)),
    path.join(repoRoot, "public", "favicon.ico"),
  );

  // 5. Next.js App Router auto-wired icons:
  //    • icon.svg   — scalable favicon (preferred by modern browsers)
  //    • icon.png   — raster fallback
  //    • apple-icon.png — home-screen tile
  console.log("Rendering Next.js App Router icons...");
  await fs.copyFile(ICON_SVG, path.join(APP_DIR, "icon.svg"));
  logWrite(path.join(APP_DIR, "icon.svg"));
  await renderSquarePng(iconSvg, 512, path.join(APP_DIR, "icon.png"), { flatten: true });
  await renderSquarePng(iconSvg, 180, path.join(APP_DIR, "apple-icon.png"), {
    flatten: true,
  });

  // 6. iOS splash screens (Void canvas + centered mark at ~30% of the width).
  console.log("Rendering iOS splash screens...");
  for (const [width, height] of SPLASH_SIZES) {
    const out = path.join(SPLASH_DIR, `splash-${width}x${height}.png`);
    await renderMarkOnVoid(markSvg, width, height, Math.round(width * 0.3), out);
  }

  console.log(`\nDone. ${written.length} files written.`);
}

main().catch((err) => {
  console.error("generate-icons failed:", err);
  process.exit(1);
});

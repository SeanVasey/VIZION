// VIZ(IO)N PWA icon + splash generator.
//
// Renders placeholder brand assets (icons, maskable tiles, apple-touch-icon,
// Next.js App Router favicons, and iOS splash screens) from SVG glyph builders
// using sharp. These are intentionally PLACEHOLDER assets — swap in the real
// Bebas-Neue artwork later. Run with: node scripts/generate-icons.mjs
//
// Idempotent: every output is overwritten on each run.

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";

import { transparentGlyphSvg, maskableTileSvg, appTileSvg } from "./lib/glyph.mjs";

// Resolve paths relative to the repo root (this script lives in scripts/).
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const ICONS_DIR = path.join(repoRoot, "public", "icons");
const SPLASH_DIR = path.join(repoRoot, "public", "splash");
const APP_DIR = path.join(repoRoot, "src", "app");

// Transparent fill for the "any" purpose PNGs.
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
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

// Render an SVG string to a square PNG with the given background.
async function renderSquarePng(svg, size, outPath, background) {
  await sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size, { fit: "contain", background })
    .png()
    .toFile(outPath);
  logWrite(outPath);
}

// Composite the centered transparent glyph onto a Void canvas of WxH (splash).
async function renderSplashPng(width, height, outPath) {
  // Glyph occupies ~30% of the splash width; render at that pixel size.
  const glyphSize = Math.round(width * 0.3);
  const glyphPng = await sharp(Buffer.from(transparentGlyphSvg(glyphSize)), {
    density: 384,
  })
    .resize(glyphSize, glyphSize, {
      fit: "contain",
      background: TRANSPARENT,
    })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: VOID,
    },
  })
    .composite([{ input: glyphPng, gravity: "centre" }])
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
  // Ensure output directories exist.
  await fs.mkdir(ICONS_DIR, { recursive: true });
  await fs.mkdir(SPLASH_DIR, { recursive: true });
  await fs.mkdir(APP_DIR, { recursive: true });

  // 1. Transparent "any" icon matrix.
  console.log("Rendering transparent 'any' icons...");
  for (const size of ANY_SIZES) {
    const out = path.join(ICONS_DIR, `icon-${size}.png`);
    await renderSquarePng(transparentGlyphSvg(size), size, out, TRANSPARENT);
  }

  // 2. Maskable set (full-bleed Void tile, glyph in 80% safe zone).
  console.log("Rendering maskable icons...");
  for (const size of [192, 512]) {
    const out = path.join(ICONS_DIR, `maskable-${size}.png`);
    await renderSquarePng(maskableTileSvg(size), size, out, VOID);
  }

  // 3. apple-touch-icon (opaque Void tile — iOS ignores transparency).
  console.log("Rendering apple-touch-icon...");
  await renderSquarePng(
    appTileSvg(180),
    180,
    path.join(ICONS_DIR, "apple-touch-icon.png"),
    VOID,
  );

  // 4. Favicon PNGs (filled tile reads better at small sizes).
  console.log("Rendering favicons...");
  for (const size of [16, 32, 48]) {
    const out = path.join(ICONS_DIR, `favicon-${size}.png`);
    await renderSquarePng(appTileSvg(size), size, out, VOID);
  }

  // 5. Next.js App Router auto-wired favicons (src/app/icon.png,
  //    src/app/apple-icon.png). No .ico is produced.
  console.log("Rendering Next.js App Router icons...");
  await renderSquarePng(appTileSvg(512), 512, path.join(APP_DIR, "icon.png"), VOID);
  await renderSquarePng(appTileSvg(180), 180, path.join(APP_DIR, "apple-icon.png"), VOID);

  // 6. iOS splash placeholders (Void canvas + centered glyph).
  console.log("Rendering iOS splash screens...");
  for (const [width, height] of SPLASH_SIZES) {
    const out = path.join(SPLASH_DIR, `splash-${width}x${height}.png`);
    await renderSplashPng(width, height, out);
  }

  console.log(`\nDone. ${written.length} files written.`);
}

main().catch((err) => {
  console.error("generate-icons failed:", err);
  process.exit(1);
});

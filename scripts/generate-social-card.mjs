// VIZION social share-artwork generator. Writes TWO files:
//
//   • social-card.png — the 1280×640 landscape card. Now the TWITTER image
//     only (`summary_large_image`), plus the artwork to upload under
//     GitHub → Settings → General → Social preview.
//   • og-tile.png     — a 1200×1200 brand tile, Void mark on a Laser plate:
//     the same artwork as the light app icon, at share resolution. This is the
//     `og:image`.
//
// WHY TWO. Everything that reads `og:image` — iOS, Slack, Discord, iMessage —
// crops it toward a SQUARE. Measured against the landscape card: iOS Safari's
// Share Sheet takes the centre 640×640, which cuts the mark down to the right
// arm of the chevron and clips the mode list mid-line, so the sheet showed a
// beheaded logo and a broken sentence. A square source has no crop to survive.
// X is the one consumer that genuinely wants 2:1, and it reads `twitter:image`
// first — so it keeps the card. (Owner decision, 2026-08-11.)
//
// Run with:
//
//   node scripts/generate-social-card.mjs
//
// WHY A BROWSER, NOT sharp
// ------------------------
// generate-icons.mjs rasterizes with sharp because icons are pure vector fills —
// no text. This card carries the Bebas Neue wordmark, and Bebas Neue is a
// VENDORED woff2 (src/app/fonts/), not a system font (fontconfig here ships only
// DejaVu/Liberation). librsvg/sharp would silently fall back to a system face
// and the wordmark would render off-brand. Chromium renders the vendored
// @font-face exactly, so the card matches the app's real wordmark. Playwright is
// already a devDependency and its Chromium is what the e2e suite drives.
//
// SOURCE OF TRUTH
// ---------------
//   • colours  — read from src/styles/tokens.css (NOT restated here; the same
//     rule generate-icons.mjs follows, for the same reason: art authored beside
//     the tokens drifts a hue band before anyone notices).
//   • the mark — the master public/brand/vizion-glyph.svg path, the one shape
//     BrandMark inlines and the icons are composed from.
//   • the wordmark — "VIZ" + "IO" + "N", the IO in --laser, per Wordmark.tsx.
//
// Not byte-reproducible across platforms (font hinting/AA differ), so — unlike
// the icon matrix — no guard test pins its bytes. It is a presentation asset,
// regenerated on demand, not a checked invariant.

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { chromium } from "@playwright/test";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const TOKENS = path.join(repoRoot, "src", "styles", "tokens.css");
const GLYPH = path.join(repoRoot, "public", "brand", "vizion-glyph.svg");
const FONTS = path.join(repoRoot, "src", "app", "fonts");
const OUT = path.join(repoRoot, "public", "brand", "social-card.png");
const TILE_OUT = path.join(repoRoot, "public", "brand", "og-tile.png");

const WIDTH = 1280;
const HEIGHT = 640;
const TILE = 1200;

// --- Colours, straight out of tokens.css (dark block = first match) ---------
const tokensCss = await fs.readFile(TOKENS, "utf8");
function token(name) {
  const m = tokensCss.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!m) throw new Error(`tokens.css: --${name} not found (or is not a hex)`);
  return m[1];
}
const VOID = token("void"); // page bg / the tile's ink
const CHALK = token("chalk"); // primary text
const SILVER = token("silver"); // muted text
const LASER = token("laser"); // accent / the tile's plate

// --- The master mark --------------------------------------------------------
const glyphSrc = await fs.readFile(GLYPH, "utf8");
const viewBox = glyphSrc.match(/viewBox="([-\d.\s]+)"/)?.[1];
const glyphD = glyphSrc.match(/<path[^>]*\bd="([^"]+)"/)?.[1];
if (!viewBox || !glyphD) throw new Error(`${GLYPH}: missing viewBox or <path d>`);

// --- The square og:image tile ------------------------------------------------
// Same composition as the app icon's Light appearance (generate-icons.mjs):
// full-bleed plate, glyph at 0.74 of the width, optically lifted 1.56% of the
// canvas. Deliberately NO rounded corners and no gloss — a share thumbnail is
// masked by whatever renders it, exactly as a home-screen tile is.
const FRAC = 0.74;
const LIFT = 0.0156;

async function writeTile() {
  const [, , gw, gh] = viewBox.trim().split(/\s+/).map(Number);
  const scale = (TILE * FRAC) / gw;
  const tx = (TILE - gw * scale) / 2;
  const ty = (TILE - gh * scale) / 2 - LIFT * TILE;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" ` +
    `viewBox="0 0 ${TILE} ${TILE}">` +
    `<rect width="${TILE}" height="${TILE}" fill="${LASER}"/>` +
    `<g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${scale.toFixed(5)})">` +
    `<path d="${glyphD}" fill="${VOID}" fill-rule="evenodd"/></g></svg>`;
  await fs.mkdir(path.dirname(TILE_OUT), { recursive: true });
  await sharp(Buffer.from(svg))
    .flatten({ background: LASER })
    .png({ compressionLevel: 9 })
    .toFile(TILE_OUT);
  console.log(`wrote ${path.relative(repoRoot, TILE_OUT)} (${TILE}×${TILE})`);
}

// --- Vendored display + body faces, embedded so Chromium needs no network ----
async function dataUri(file, mime) {
  const buf = await fs.readFile(path.join(FONTS, file));
  return `data:${mime};base64,${buf.toString("base64")}`;
}
const bebas = await dataUri("BebasNeue-Regular.woff2", "font/woff2");
const reddit = await dataUri("RedditSans-400.woff2", "font/woff2");
const redditMed = await dataUri("RedditSans-500.woff2", "font/woff2");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: "Bebas Neue"; src: url(${bebas}) format("woff2"); font-weight: 400; }
  @font-face { font-family: "Reddit Sans"; src: url(${reddit}) format("woff2"); font-weight: 400; }
  @font-face { font-family: "Reddit Sans"; src: url(${redditMed}) format("woff2"); font-weight: 500; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; }
  body {
    background:
      radial-gradient(120% 140% at 22% 12%, ${LASER}1f 0%, ${LASER}00 46%),
      radial-gradient(90% 120% at 88% 96%, ${LASER}12 0%, ${LASER}00 50%),
      ${VOID};
    color: ${CHALK};
    display: flex; align-items: center; gap: 72px;
    padding: 0 96px;
    font-family: "Reddit Sans", sans-serif;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
  }
  .mark { width: 300px; height: 300px; flex: 0 0 auto; filter: drop-shadow(0 0 42px ${LASER}33); }
  .mark svg { width: 100%; height: 100%; display: block; }
  .copy { display: flex; flex-direction: column; }
  .wordmark {
    font-family: "Bebas Neue", sans-serif;
    font-size: 176px; line-height: 0.9; letter-spacing: 0.06em;
  }
  .wordmark .io { color: ${LASER}; }
  .tagline { margin-top: 22px; font-size: 40px; font-weight: 500; color: ${CHALK}; letter-spacing: -0.01em; }
  .modes { margin-top: 16px; font-size: 25px; color: ${SILVER}; letter-spacing: 0.005em; }
  .brand {
    margin-top: 40px; display: inline-flex; align-items: center; gap: 12px;
    font-size: 22px; letter-spacing: 0.14em; text-transform: uppercase; color: ${SILVER};
  }
  .brand .dot { width: 12px; height: 12px; border-radius: 50%; background: ${LASER}; box-shadow: 0 0 12px ${LASER}aa; }
</style></head><body>
  <div class="mark">
    <svg viewBox="${viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="${glyphD}" fill="${LASER}" fill-rule="evenodd"/>
    </svg>
  </div>
  <div class="copy">
    <div class="wordmark">VIZ<span class="io">IO</span>N</div>
    <div class="tagline">Prompt-engineering studio</div>
    <div class="modes">Clarify · Polish · Expand · Condense · Reformat · Adapt — across sixteen models</div>
    <div class="brand"><span class="dot"></span>A VASEY/AI production</div>
  </div>
</body></html>`;

await writeTile();

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await page.screenshot({
    path: OUT,
    clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
  });
  console.log(`wrote ${path.relative(repoRoot, OUT)} (${WIDTH}×${HEIGHT})`);
} finally {
  await browser.close();
}

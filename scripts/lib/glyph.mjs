// VIZ(IO)N brand glyph SVG builders.
//
// These return self-contained SVG strings rendered later to PNG via sharp.
// IMPORTANT: the generator must run WITHOUT external font files, so the
// display face (Bebas-Neue-like, tall condensed) is approximated here with
// a heavy "Arial Narrow" system stack as an explicit, swappable PLACEHOLDER.
//
// Locked palette (see VIZION-style-guide.html, product spec §1.1/§1.2):
const VOID = "#0F1012"; // background
const SILVER = "#B9BCC5"; // aperture brackets
const LASER = "#B7FF3C"; // glyph accent (I, chevron, O)

// Condensed, heavy system stack standing in for Bebas Neue.
const FONT_STACK = "'Arial Narrow', 'Helvetica Neue Condensed', Arial, sans-serif";

// Build the centered `( I ›O )` aperture lockup as a group of <text> nodes.
// `cx`/`cy` are the lockup center; `unit` scales the whole composition so the
// same routine serves icons, tiles, and splashes. The brackets are drawn in
// Silver at a lighter weight (~40%), the I / chevron / O in Laser.
function apertureLockup(cx, cy, unit) {
  // Glyph cap-height and the horizontal step between elements.
  const fontSize = unit;
  const step = unit * 0.46;
  // Bracket weight is ~40% of the glyph weight; emulate via lighter stroke.
  const bracketStroke = Math.max(1, unit * 0.03);
  // Nudge text baseline so dominant-baseline=central reads true across renderers.
  const baseline = cy + fontSize * 0.02;

  // Positions, left to right: ( I › O )
  const xOpen = cx - step * 2.05;
  const xI = cx - step * 0.95;
  const xChevron = cx;
  const xO = cx + step * 0.95;
  const xClose = cx + step * 2.05;

  // Shared attrs WITHOUT font-size — each node sets its own size exactly once
  // (librsvg rejects a redefined attribute).
  // Shared attrs carry only properties that never vary per node, so nothing is
  // ever redefined (librsvg rejects a duplicated attribute).
  const baseAttrs =
    `text-anchor="middle" dominant-baseline="central" ` +
    `font-family="${FONT_STACK}" font-stretch="condensed"`;
  const fs = fontSize.toFixed(2);
  const chevronFs = (fontSize * 0.82).toFixed(2);

  return [
    // Silver aperture brackets (lighter weight via thin stroke + Silver fill).
    `<text x="${xOpen.toFixed(2)}" y="${baseline.toFixed(2)}" ${baseAttrs} ` +
      `font-size="${fs}" font-weight="400" fill="${SILVER}" stroke="${SILVER}" ` +
      `stroke-width="${bracketStroke.toFixed(2)}">(</text>`,
    `<text x="${xClose.toFixed(2)}" y="${baseline.toFixed(2)}" ${baseAttrs} ` +
      `font-size="${fs}" font-weight="400" fill="${SILVER}" stroke="${SILVER}" ` +
      `stroke-width="${bracketStroke.toFixed(2)}">)</text>`,
    // Laser I, transformation chevron, O.
    `<text x="${xI.toFixed(2)}" y="${baseline.toFixed(2)}" ${baseAttrs} ` +
      `font-size="${fs}" font-weight="900" fill="${LASER}">I</text>`,
    `<text x="${xChevron.toFixed(2)}" y="${baseline.toFixed(2)}" ${baseAttrs} ` +
      `font-size="${chevronFs}" font-weight="900" fill="${LASER}">›</text>`,
    `<text x="${xO.toFixed(2)}" y="${baseline.toFixed(2)}" ${baseAttrs} ` +
      `font-size="${fs}" font-weight="900" fill="${LASER}">O</text>`,
  ].join("\n  ");
}

// Transparent background; the `( I ›O )` aperture lockup centered.
// No tile/background fill — for the PWA "any" purpose set.
export function transparentGlyphSvg(size) {
  const lockup = apertureLockup(size / 2, size / 2, size * 0.5);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${lockup}
</svg>`;
}

// Full-bleed Void tile (slightly rounded) with the glyph inside the ~80%
// safe zone (~10% padding all around) so the OS maskable crop never clips it.
export function maskableTileSvg(size) {
  const radius = size * 0.06; // subtle rounding; mask shapes the real corners.
  // Safe zone is the inner 80%; size the lockup off that, not the full canvas.
  const lockup = apertureLockup(size / 2, size / 2, size * 0.5 * 0.8);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="0" y="0" width="${size}" height="${size}" rx="${radius.toFixed(2)}" ry="${radius.toFixed(2)}" fill="${VOID}"/>
  ${lockup}
</svg>`;
}

// Void rounded-square app tile (corner radius ~22%) with the glyph.
// Used for apple-touch-icon / favicons where a filled tile reads better.
export function appTileSvg(size) {
  const radius = size * 0.22;
  const lockup = apertureLockup(size / 2, size / 2, size * 0.5);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="0" y="0" width="${size}" height="${size}" rx="${radius.toFixed(2)}" ry="${radius.toFixed(2)}" fill="${VOID}"/>
  ${lockup}
</svg>`;
}

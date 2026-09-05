// Browser pixel assertions shared by Playwright tests and local verification.
// The caller supplies a real Playwright Page. No installation is simulated.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { installedColorway } from "./generate-icons.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const C = installedColorway();
const rgb = (hex) =>
  hex
    .slice(1)
    .match(/../g)
    .map((v) => parseInt(v, 16));
async function pixels(png) {
  return sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}
function at(image, x, y) {
  const start = (y * image.info.width + x) * 4;
  return [...image.data.subarray(start, start + 4)];
}
export async function renderIconInBrowser(page, svg, size, scheme) {
  await page.goto("about:blank");
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize({ width: Math.max(400, size), height: Math.max(400, size) });
  const uri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  await page.setContent(
    `<html style="color-scheme:light dark;background:transparent"><body style="margin:0;background:transparent"><img id="icon" alt="Authored icon fixture" src="${uri}" width="${size}" height="${size}"></body></html>`,
  );
  await page.locator("#icon").evaluate((image) => image.decode());
  return page
    .locator("#icon")
    .screenshot({ omitBackground: true, animations: "disabled" });
}

export async function verifyIconBrowser(page) {
  const svg = await fs.readFile(path.join(ROOT, "public/icons/app-icon.svg"), "utf8");
  const foreground = svg
    .replace(/<style>.*?<\/style>/gs, "")
    .replace(/<rect\b[^>]*\/>/g, "");
  const checks = [];
  /** @type {Record<string, Buffer>} */
  const screenshots = {};
  for (const size of [60, 120, 180]) {
    const lightPng = await renderIconInBrowser(page, svg, size, "light");
    const darkPng = await renderIconInBrowser(page, svg, size, "dark");
    const light = await pixels(lightPng),
      dark = await pixels(darkPng);
    assert.deepEqual(at(light, 1, 1).slice(0, 3), rgb(C.plate));
    const darkCorner = at(dark, 1, 1).slice(0, 3);
    assert(darkCorner.every((v, i) => Math.abs(v - rgb(C.plateDarkTop)[i]) <= 2));
    assert.notDeepEqual(at(light, 1, 1), at(dark, 1, 1));
    const mask = await pixels(await renderIconInBrowser(page, foreground, size, "light"));
    // Compare every mark pixel that is not an anti-aliased edge: opaque itself
    // and with all eight neighbours opaque (a 1 px erosion — AA is 1 px wide).
    // The threshold is a share of the mark's own opaque area, not a function of
    // the canvas: with no outline the ring is ~3 px wide at 60 px, so a 2 px
    // erosion left nothing to compare and a canvas-sized floor was unreachable.
    let opaque = 0;
    let compared = 0;
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        if (at(mask, x, y)[3] !== 255) continue;
        opaque++;
        let interior = true;
        for (let dy = -1; dy <= 1 && interior; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (at(mask, x + dx, y + dy)[3] !== 255) {
              interior = false;
              break;
            }
          }
        }
        if (!interior) continue;
        assert.deepEqual(at(light, x, y), at(dark, x, y));
        compared++;
      }
    }
    assert(
      compared >= opaque * 0.15 && compared > 0,
      `Too few interior foreground pixels at ${size}px (${compared} of ${opaque} opaque)`,
    );
    checks.push({
      size,
      scheme: "light/dark",
      invariantInteriorPixels: compared,
      lightPlate: at(light, 1, 1),
      darkPlate: at(dark, 1, 1),
    });
    screenshots[`light-${size}.png`] = lightPng;
    screenshots[`dark-${size}.png`] = darkPng;
  }
  return {
    checks,
    screenshots,
    scope: "Chromium external-SVG rendering; not iPhone Home Screen behavior",
  };
}

export async function verifyIconFallbackBrowser(page) {
  const svg = await fs.readFile(path.join(ROOT, "public/icons/app-icon.svg"), "utf8");
  const stripped = svg.replace(/<style>.*?<\/style>/gs, "");
  const broken = stripped.replace(` fill="${C.plate}"`, "");
  const checks = [];
  /** @type {Record<string, Buffer>} */
  const screenshots = {};
  for (const size of [60, 120, 180]) {
    for (const scheme of ["light", "dark"]) {
      const png = await renderIconInBrowser(page, stripped, size, scheme);
      const image = await pixels(png);
      assert.deepEqual(at(image, 1, 1), [...rgb(C.plate), 255]);
      const old = await pixels(await renderIconInBrowser(page, broken, size, scheme));
      assert.deepEqual(at(old, 1, 1).slice(0, 3), [0, 0, 0]);
      checks.push({ size, scheme, fallback: "lime", missingAttributeControl: "black" });
      if (size === 180) screenshots[`fallback-${scheme}-${size}.png`] = png;
    }
  }
  return {
    checks,
    screenshots,
    scope: "Stylesheet-stripped browser fixture, not a claim that iOS strips styles",
  };
}

/**
 * Compile the hand-authored Workbox SOURCE (`src/lib/pwa/sw-src.js`) into the
 * registered service worker (`public/sw.js`).
 *
 * `workbox-build`'s `injectManifest` only string-injects the precache manifest —
 * it does NOT bundle. A hand-authored source that `import`s the `workbox-*`
 * packages would therefore ship bare ESM imports that a classic service worker
 * cannot evaluate. So we do it in two steps:
 *
 *   1. esbuild bundles the source (resolving `workbox-*` from node_modules) into
 *      a single classic-worker IIFE, preserving the `self.__WB_MANIFEST` token.
 *   2. `injectManifest` replaces that token with the real precache manifest and
 *      writes `public/sw.js`.
 *
 * Pre-build we cannot glob the Next.js `.next` output, so we precache from the
 * static `public/` directory only (icons + manifest + offline.html). No app
 * route is precached — every navigation is NetworkOnly and falls back to
 * offline.html, so there is no "app-shell entry" (the accurate rationale is at
 * the injectManifest call below). Runs via the `prebuild` npm hook. Exits
 * non-zero on failure.
 */

import { build as esbuild } from "esbuild";
import { injectManifest } from "workbox-build";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SW_SRC = "src/lib/pwa/sw-src.js";
const SW_DEST = "public/sw.js";

async function main() {
  const workDir = await mkdtemp(join(tmpdir(), "vizion-sw-"));
  const bundled = join(workDir, "sw-bundled.js");

  try {
    // 1. Bundle the hand-authored source into a classic-worker IIFE.
    await esbuild({
      entryPoints: [SW_SRC],
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "es2020",
      minify: true,
      outfile: bundled,
      // Keep the precache placeholder intact for injectManifest to replace.
      define: {},
      logLevel: "warning",
    });

    // 2. Inject the precache manifest into the bundled worker. We precache only
    // static, auth-agnostic assets — `offline.html` is the navigation fallback
    // (offline.js is its external recovery script; both or neither).
    // App routes are auth-gated (they redirect by session state), so they are
    // cached at runtime via stale-while-revalidate rather than precached.
    //
    // Only the icons the OFFLINE experience actually needs are precached: the
    // manifest's install icons (192/256/384/512 + maskable). icon-1024
    // (115 KB, an App-Store artifact), the favicons, and the intermediate iOS
    // sizes are browser-chrome assets the SW never needs offline (PERF-005 /
    // DEAD-001) — still served on demand and runtime-cached by the
    // StaleWhileRevalidate image route. `icons/**/*.png` swept all 19 and
    // spent ~130 KB of first-visit data on assets no offline path uses.
    // The home-screen tile left the list 2026-08-09 (audit 04 pwa-04,
    // owner-approved): nothing that runs offline requests one — iOS reads it
    // once, at Add-to-Home-Screen time, over the network. It stays off now that
    // the layout links it directly at /icons/, for the same reason: the tile is
    // captured at install, never on a cold offline launch. (There is one tile
    // now, `icons/apple-touch-icon-dark.png`; the light twin this comment used
    // to name was deleted with the media pair — ADR-0015.) PERF-005's
    // disposition listed it as offline-needed; that clause was a mistaken
    // carry-over.
    const { count, size, warnings } = await injectManifest({
      swSrc: bundled,
      swDest: SW_DEST,
      globDirectory: "public",
      globPatterns: [
        "offline.html",
        "offline.js",
        "manifest.webmanifest",
        "icons/icon-192.png",
        "icons/icon-256.png",
        "icons/icon-384.png",
        "icons/icon-512.png",
        "icons/maskable-192.png",
        "icons/maskable-512.png",
      ],
    });

    for (const warning of warnings) {
      console.warn(warning);
    }

    const sizeKb = (size / 1024).toFixed(1);
    console.log(`[build-sw] Precached ${count} entries (${sizeKb} KiB) → ${SW_DEST}.`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("[build-sw] Failed to build service worker:");
  console.error(error);
  process.exit(1);
});

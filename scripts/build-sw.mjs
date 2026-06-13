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
 * static `public/` directory plus a manually injected app-shell entry for
 * `/enhance`. The shell revision is a build timestamp so it revalidates each
 * deploy. Runs via the `prebuild` npm hook. Exits non-zero on failure.
 */

import { build as esbuild } from "esbuild";
import { injectManifest } from "workbox-build";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SW_SRC = "src/lib/pwa/sw-src.js";
const SW_DEST = "public/sw.js";
const buildRevision = Date.now().toString(36);

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

    // 2. Inject the precache manifest into the bundled worker.
    const { count, size, warnings } = await injectManifest({
      swSrc: bundled,
      swDest: SW_DEST,
      globDirectory: "public",
      globPatterns: ["icons/**/*.png", "manifest.webmanifest", "offline.html"],
      // The app shell is served by Next at runtime (not present in `public/`),
      // so inject it manually with a per-build revision. We precache `/enhance` —
      // the real entry screen — rather than `/`, because `/` issues a redirect
      // and Workbox refuses to precache a redirected response (install fails).
      additionalManifestEntries: [{ url: "/enhance", revision: buildRevision }],
    });

    for (const warning of warnings) {
      console.warn(warning);
    }

    const sizeKb = (size / 1024).toFixed(1);
    console.log(
      `[build-sw] Precached ${count} entries (${sizeKb} KiB) → ${SW_DEST} ` +
        `(shell revision ${buildRevision}).`,
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("[build-sw] Failed to build service worker:");
  console.error(error);
  process.exit(1);
});

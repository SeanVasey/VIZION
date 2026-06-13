/**
 * VIZ(IO)N — Workbox service worker SOURCE.
 *
 * This is the hand-authored injectManifest SOURCE. It is compiled by
 * `scripts/build-sw.mjs` (workbox-build `injectManifest`) into `public/sw.js`,
 * which is the file actually registered in the browser. Do NOT register this
 * file directly. It is plain JS and excluded from the TypeScript project.
 *
 * The Workbox manifest placeholder below is replaced at build time with the
 * precache manifest (app shell + static assets). It must appear exactly once.
 *
 * Caching strategy (FINAL_PLAN §3):
 *  - App shell + same-origin static assets (navigations, script/style/font/image)
 *    → StaleWhileRevalidate (`vizion-shell`). Instant loads, refresh in background.
 *  - `/api/enhance` + auth (Supabase `/api/auth`) → NetworkFirst (`vizion-enhance`)
 *    with a short network timeout. We NEVER serve a stale enhancement: there is no
 *    long-lived cache fallback here — the cache is a last resort only and entries
 *    expire almost immediately.
 *  - Library / history reads (`/api/library`, `/api/prompts`) → NetworkFirst with a
 *    real cache fallback (`vizion-library`, ~50 entries / 1 day) so saved work is
 *    visible offline.
 *  - Offline navigation fallback: a failed navigation serves the precached `/`
 *    shell document via `setCatchHandler`.
 */

import { clientsClaim } from "workbox-core";
import {
  precacheAndRoute,
  createHandlerBoundToURL,
  cleanupOutdatedCaches,
} from "workbox-precaching";
import { registerRoute, setCatchHandler } from "workbox-routing";
import { StaleWhileRevalidate, NetworkFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

// Centralized cache names.
const SHELL_CACHE = "vizion-shell";
const ENHANCE_CACHE = "vizion-enhance";
const LIBRARY_CACHE = "vizion-library";

// The offline navigation fallback. With auth gating, every app route redirects
// depending on session state (so none is safe to precache as "the shell").
// `/offline.html` is a static, auth-agnostic document that is always available;
// authenticated routes the user has visited are served from the runtime
// stale-while-revalidate cache instead.
const APP_SHELL_URL = "/offline.html";

// --- Lifecycle ------------------------------------------------------------

self.addEventListener("install", () => {
  self.skipWaiting();
});

clientsClaim();
cleanupOutdatedCaches();

// Precache the app shell + static assets injected at build time.
precacheAndRoute(self.__WB_MANIFEST);

// Allow a waiting worker to activate immediately when the page asks it to.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// --- Runtime routes -------------------------------------------------------

// 1. Navigations + same-origin static assets → StaleWhileRevalidate.
const isShellAsset = ({ request, sameOrigin }) => {
  if (!sameOrigin) return false;
  if (request.mode === "navigate") return true;
  return ["script", "style", "font", "image"].includes(request.destination);
};

registerRoute(
  ({ request, sameOrigin }) => isShellAsset({ request, sameOrigin }),
  new StaleWhileRevalidate({
    cacheName: SHELL_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 7 * 24 * 60 * 60 }),
    ],
  }),
);

// 2. Enhancement + auth → NetworkFirst, short timeout, never serve stale.
registerRoute(
  ({ url }) =>
    url.pathname.startsWith("/api/enhance") ||
    url.pathname.startsWith("/api/auth") ||
    url.pathname.includes("/auth/v1"),
  new NetworkFirst({
    cacheName: ENHANCE_CACHE,
    networkTimeoutSeconds: 10,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      // Effectively no stale fallback: keep at most a couple of entries for a
      // few seconds so an enhancement is never served from a previous run.
      new ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 30 }),
    ],
  }),
);

// 3. Library / history reads → NetworkFirst with cache fallback.
registerRoute(
  ({ url }) =>
    url.pathname.startsWith("/api/library") || url.pathname.startsWith("/api/prompts"),
  new NetworkFirst({
    cacheName: LIBRARY_CACHE,
    networkTimeoutSeconds: 10,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 24 * 60 * 60 }),
    ],
  }),
);

// --- Offline navigation fallback -----------------------------------------

const appShellHandler = createHandlerBoundToURL(APP_SHELL_URL);

setCatchHandler(async (options) => {
  const { request } = options;
  if (request.mode === "navigate") {
    try {
      return await appShellHandler(options);
    } catch {
      return Response.error();
    }
  }
  return Response.error();
});

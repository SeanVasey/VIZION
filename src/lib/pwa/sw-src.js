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
 *    The page purges this cache whenever the auth gate is shown (register-sw.ts)
 *    so a signed-out browser is never served the previous session's HTML.
 *  - Model + auth endpoints are deliberately NOT routed: `/api/enhance` and
 *    `/api/media` are POST-only (a GET runtime route can never match them, and
 *    responses must never be cached), and Supabase `/auth/v1` responses carry
 *    session PII that must not enter Cache Storage. Library data flows through
 *    server components / server actions (also uncacheable), with the IndexedDB
 *    outbox covering offline writes.
 *  - Offline navigation fallback: a failed navigation serves the precached
 *    `/offline.html` via `setCatchHandler`.
 */

import { clientsClaim } from "workbox-core";
import {
  precacheAndRoute,
  createHandlerBoundToURL,
  cleanupOutdatedCaches,
} from "workbox-precaching";
import { registerRoute, setCatchHandler } from "workbox-routing";
import { StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

// Centralized cache names.
const SHELL_CACHE = "vizion-shell";

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
// (Workbox does pass `sameOrigin`, but we check `url.origin` explicitly so the
// same-origin guard is self-evident and not reliant on the callback shape.)
const isShellAsset = ({ request, url }) => {
  if (url.origin !== self.location.origin) return false;
  if (request.mode === "navigate") return true;
  return ["script", "style", "font", "image"].includes(request.destination);
};

registerRoute(
  ({ request, url }) => isShellAsset({ request, url }),
  new StaleWhileRevalidate({
    cacheName: SHELL_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 7 * 24 * 60 * 60 }),
    ],
  }),
);

// (Former runtime routes 2 and 3 are intentionally gone. Route 2 targeted
// POST-only endpoints — GET-only runtime routes can never match them — so its
// sole live effect was caching cross-origin Supabase /auth/v1 GET responses
// (session PII) into Cache Storage. Route 3 targeted /api/library and
// /api/prompts, endpoints that have never existed — library data flows through
// server components and server actions. Dead-or-harmful config, removed.)

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

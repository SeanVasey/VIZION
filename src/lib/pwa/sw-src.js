/**
 * VIZION — Workbox service worker SOURCE.
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
 *  - Same-origin STATIC assets (script/style/font/image) → StaleWhileRevalidate
 *    (`vizion-shell`).
 *  - Navigations → NetworkOnly. Deliberately not cached: Cache Storage is
 *    origin-wide, not account-scoped, and `/library`, `/library/[id]` and
 *    `/profile` are server-rendered with the account's prompts, previews and
 *    email. Persisting that HTML meant a hard navigation after a session change
 *    on a shared device could paint the previous account's content before
 *    revalidation replaced it. The `register-sw.ts` purge on the auth gate is a
 *    mitigation, not a fix: it only fires on `/sign-in`, after the leak window.
 *    NetworkOnly rather than no route at all — see route 2 for why that
 *    distinction is what keeps the offline fallback working.
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
import { NetworkOnly, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

// Centralized cache names.
const SHELL_CACHE = "vizion-shell";

// The offline navigation fallback. With auth gating, every app route redirects
// depending on session state (so none is safe to precache as "the shell").
// `/offline.html` is a static, auth-agnostic document that is always available.
// Navigations are NetworkOnly (route 2 below), so OFFLINE every navigation —
// visited or not — serves this fallback; the runtime cache holds only
// same-origin static assets, never page HTML (CACHE-01).
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

// 1. Same-origin static assets → StaleWhileRevalidate. Navigations are not
// routed here; they go to the network and, on failure, to the catch handler.
// (Workbox does pass `sameOrigin`, but we check `url.origin` explicitly so the
// same-origin guard is self-evident and not reliant on the callback shape.)
const isShellAsset = ({ request, url }) => {
  if (url.origin !== self.location.origin) return false;
  // Navigations are handled by route 2 instead — they render account content,
  // and Cache Storage is shared across every session on this origin.
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

// 2. Navigations → NetworkOnly.
//
// They must be ROUTED, not merely left unmatched. `setCatchHandler` only runs
// for a request some Workbox route actually handled; a navigation that matches
// no route never enters Workbox at all, so offline it fails to the browser's
// own error page and the /offline.html fallback below never fires.
//
// Dropping the old navigation route without adding this is what broke the
// offline fallback — caught by `shell.spec.ts`'s offline test, which is the
// only thing in the suite that exercises the real service worker. (The
// reverted PR #62 made the same removal, with the same incorrect comment
// claiming the catch handler would still cover it.)
//
// NetworkOnly gives both halves: the response is never written to Cache
// Storage, so no account HTML is persisted to an origin-wide store, and the
// request stays inside Workbox so a failure reaches the catch handler.
registerRoute(({ request }) => request.mode === "navigate", new NetworkOnly());

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

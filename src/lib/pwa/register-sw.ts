/**
 * Service-worker registration helper for VIZ(IO)N.
 *
 * Registers `public/sw.js` (compiled from `sw-src.js` by `scripts/build-sw.mjs`).
 * Designed to be called once from a client component. It is React-free,
 * side-effect-safe, and never throws.
 */

/**
 * Whether the current context is allowed to register a service worker.
 * Service workers require a secure context: production, https, or localhost.
 */
function canRegister(): boolean {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return false;
  }
  if (process.env.NODE_ENV === "production") {
    return true;
  }
  const { protocol, hostname } = window.location;
  return protocol === "https:" || hostname === "localhost" || hostname === "127.0.0.1";
}

/**
 * Best-effort request for persistent storage. iOS/WebKit may evict
 * service-worker caches under storage pressure; persistence mitigates that.
 * Never throws.
 *
 * VERIFIED (2026-07-28): the claim holds, and it matters more here than most
 * apps. Safari 17 / iOS 17 support the Storage API in full, and WebKit grants
 * `persist()` on heuristics that explicitly include *"opened as a Home Screen
 * Web App"* — i.e. exactly VIZ(IO)N's primary surface, the installed PWA.
 *
 * NOT COVERED BY ANY TEST, and it cannot be: `navigator.storage` is absent
 * outright in Playwright's Linux WebKit (`'storage' in navigator === false`,
 * measured in a confirmed secure context), so the e2e suite's `mobile-safari`
 * project would report this API missing on a platform that in fact has it.
 * See docs/runbooks/ios-verification.md — that divergence is the whole reason
 * that runbook exists. The double `?.` is what keeps the gap harmless.
 */
async function requestPersistentStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Best-effort only; ignore failures.
  }
}

/**
 * The same-origin static-asset cache (script/style/font/image), StaleWhile-
 * Revalidate. It holds NO page HTML — navigations are NetworkOnly and fall
 * back to /offline.html (CACHE-01). Purged whenever the auth gate is shown, as
 * defence in depth against a signed-out browser reading a prior session's
 * cached assets.
 */
const SHELL_CACHE = "vizion-shell";

function purgeShellCacheOnGate(): void {
  try {
    if (window.location.pathname === "/sign-in" && "caches" in window) {
      void caches.delete(SHELL_CACHE);
    }
  } catch {
    // Best-effort only; ignore failures.
  }
}

/**
 * Register the VIZ(IO)N service worker. Safe to call on every client mount.
 */
export function registerServiceWorker(): void {
  if (!canRegister()) {
    return;
  }

  void requestPersistentStorage();
  purgeShellCacheOnGate();

  navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then((registration) => {
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) {
          return;
        }
        installing.addEventListener("statechange", () => {
          // A new worker has installed while one is already controlling the page:
          // ask it to activate immediately so updates roll out without a reload.
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            installing.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
      // Long-lived standalone sessions never re-navigate, so the updatefound
      // path above would otherwise have nothing to find: check for a new
      // worker whenever the app returns to the foreground.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          void registration.update().catch(() => {});
        }
      });
    })
    .catch(() => {
      // Registration failures are non-fatal; the app still works online.
    });
}

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
 * Best-effort request for persistent storage. iOS/WebKit may evict service-worker
 * caches under storage pressure; persistence mitigates that. Never throws.
 */
async function requestPersistentStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Best-effort only; ignore failures.
  }
}

/**
 * The runtime cache that holds visited page HTML (see sw-src.js). Purged
 * whenever the auth gate is shown so a signed-out browser is never served the
 * previous session's cached pages.
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

import type { NextConfig } from "next";
import pkg from "./package.json" with { type: "json" };
import { cspDirectives, isHttpsOrigin } from "./src/lib/security/csp";

/**
 * Content-Security-Policy (P6 hardening, audit SEC-001).
 *
 * The per-request NONCE policy for every document now lives in the middleware
 * (`src/middleware.ts` + `src/lib/security/csp.ts`) — `script-src` there is
 * `'self' 'nonce-…'` with no `'unsafe-inline'`, and the no-flash theme
 * bootstrap plus Next's own inline scripts carry the nonce.
 *
 * What remains HERE is the static fallback for exactly the paths the
 * middleware matcher excludes and that can execute script: `offline.html`
 * (its inline reload script cannot receive a per-request nonce — it is a
 * static file) and `sw.js`. Those keep the previous `'unsafe-inline'` policy.
 * The probe history for the websocket/connect-src rules lives with the
 * builder in src/lib/security/csp.ts.
 */
export const CSP_DIRECTIVES = cspDirectives(process.env.NEXT_PUBLIC_SUPABASE_URL);

/** Headers that are correct on every transport. */
const COMMON_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

/**
 * Two headers are no-ops on an https origin and destructive on a plain-http
 * one, so they ship only when this instance is actually served over https:
 *
 *   - `upgrade-insecure-requests` rewrites every same-origin subresource URL to
 *     https. On `http://127.0.0.1:3100` — the e2e server — and on `next dev`,
 *     nothing is listening for TLS, so the stylesheet and every font fail their
 *     handshake and the app renders with NO CSS AT ALL. Chromium hides this by
 *     exempting loopback from the upgrade; WebKit does not, which is how it
 *     finally surfaced: every design token empty, every focus ring gone.
 *   - `Strict-Transport-Security` received over non-secure transport is one a
 *     UA must ignore anyway (RFC 6797 §8.1), so sending it there is noise.
 *
 * Decided at BUILD time, because `headers()` is compiled into
 * `routes-manifest.json` and never re-evaluated per request.
 *
 * The per-request alternative — `has: [{ type: "header", key:
 * "x-forwarded-proto", value: "https" }]` on one rule and `missing:` on the
 * other — DOES work; a rule keyed on an absent header is correctly skipped.
 * (An earlier revision of this comment claimed otherwise. That was wrong: the
 * probe behind it had been served by a stale `next-server` holding the port,
 * so it read the previous build's headers. Re-tested clean on an unused port.)
 *
 * It is not used because it makes the production security posture depend on
 * the proxy always setting `x-forwarded-proto` — a header this repo cannot
 * verify from a test, since preview deployments sit behind Vercel's SSO edge,
 * which substitutes its own CSP. If it were ever absent, HSTS and
 * `upgrade-insecure-requests` would vanish in production with nothing failing.
 * A build-time input is checkable end-to-end here, against the compiled
 * manifest, so that is what gates it.
 */
export function buildSecurityHeaders(httpsOrigin: boolean) {
  return [
    ...COMMON_HEADERS,
    ...(httpsOrigin
      ? [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ]
      : []),
  ];
}

/** The static-asset CSP (see the header comment): `'unsafe-inline'` script-src
 *  for the two middleware-excluded paths that can execute script. */
export function staticCspHeader(httpsOrigin: boolean) {
  return {
    key: "Content-Security-Policy",
    value: [
      ...CSP_DIRECTIVES,
      ...(httpsOrigin ? ["upgrade-insecure-requests"] : []),
    ].join("; "),
  };
}

/**
 * Production (Vercel) is https, so it gets the full set. `next dev` is http by
 * definition. A production BUILD served over http is only ever the e2e harness,
 * which opts out explicitly via `VIZION_HTTP_ORIGIN=1` (set in
 * `playwright.config.ts`) — nothing else should ever set it.
 */
export const HTTPS_ORIGIN = isHttpsOrigin();

const securityHeaders = buildSecurityHeaders(HTTPS_ORIGIN);

/**
 * Long-lived caching for the content-stable public asset trees — the icon
 * matrix, the iOS splash set, and the brand SVGs (PERF-008). Without this they
 * revalidate on every load (`max-age=0`). They are regenerated only by
 * `scripts/generate-icons.mjs`, and regeneration reuses the same filenames — so
 * `immutable` is the wrong tool (a re-brand would strand the old art behind a
 * year of forced staleness). `stale-while-revalidate` keeps the caching win — a
 * day fresh, then served stale for a week while it refreshes — and lets an
 * update propagate within a day. Fonts are already immutable (next/font emits
 * hashed `/_next/static` assets); the SW installs its own no-store policy.
 */
const STATIC_ASSET_CACHE = {
  key: "Cache-Control",
  value: "public, max-age=86400, stale-while-revalidate=604800",
};

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The brand/version pills read this at build (never hardcoded) — see R1.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
  images: {
    // Avatars come from Supabase Storage (custom uploads) or, for OAuth accounts
    // that haven't uploaded one, the provider's CDN (Google / GitHub).
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
  // Strip console output in production builds (keep error/warn for observability).
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },
  async headers() {
    return [
      {
        // Non-CSP security headers everywhere; documents get their CSP (with
        // a per-request nonce) from the middleware instead.
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // The middleware matcher excludes offline.html — it still needs a
        // policy for its inline reload script (static, so 'unsafe-inline').
        source: "/offline.html",
        headers: [staticCspHeader(HTTPS_ORIGIN)],
      },
      {
        // The service worker must never be cached so updates roll out immediately.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
          staticCspHeader(HTTPS_ORIGIN),
        ],
      },
      // Content-stable public asset trees get a long, revalidating cache instead
      // of the default max-age=0 (PERF-008). These add to — not replace — the
      // security headers from the /:path* rule above.
      { source: "/icons/:path*", headers: [STATIC_ASSET_CACHE] },
      { source: "/splash/:path*", headers: [STATIC_ASSET_CACHE] },
      { source: "/brand/:path*", headers: [STATIC_ASSET_CACHE] },
    ];
  },
};

export default nextConfig;

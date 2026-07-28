import type { NextConfig } from "next";
import pkg from "./package.json" with { type: "json" };

/**
 * Content-Security-Policy (P6 hardening). Locks the app to its own origin plus
 * Supabase (auth/db/storage/realtime). Model-provider calls are server-side only,
 * so they never appear in the browser's `connect-src`. Fonts are self-hosted via
 * next/font, so no external font origin is needed.
 *
 * Residual: `script-src 'unsafe-inline'` remains for the pre-paint no-flash theme
 * bootstrap (and Next's inline runtime). A nonce-based policy is the next step;
 * `object-src 'none'` + `base-uri 'self'` + `frame-ancestors 'none'` blunt the
 * common injection vectors in the meantime.
 */
/**
 * The Supabase origin this build is actually configured against, when the
 * hosted `*.supabase.co` wildcard below does not already cover it.
 *
 * The wildcard alone silently assumes every deployment uses a hosted project on
 * Supabase's own domain. A self-hosted instance, a custom domain, or the e2e
 * stub is blocked by `connect-src` with no server-side symptom at all — the
 * browser refuses the request, `signInWithPassword` fails, and the app just
 * never signs anyone in. Reading the origin the app is already pointed at keeps
 * the policy and the configuration from disagreeing.
 *
 * Returns null for a hosted project (the wildcard covers it) and for anything
 * unparseable, so the default deployment's policy is byte-identical to before.
 */
export function configuredSupabaseOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const { origin, hostname, protocol } = new URL(raw);
    if (protocol !== "https:" && protocol !== "http:") return null;
    // Only the ORIGIN — a stray path or query in the env value must never
    // reach the policy, where it would be meaningless at best.
    return hostname.endsWith(".supabase.co") ? null : origin;
  } catch {
    return null;
  }
}

/**
 * Takes the Supabase URL as an ARGUMENT rather than reading `process.env`
 * inside, for the same reason `buildSecurityHeaders(httpsOrigin)` does: a
 * policy that varies by environment is only testable if the environment is an
 * input. `CSP_DIRECTIVES` below binds it to the real env for Next to consume.
 */
export function cspDirectives(supabaseUrl: string | undefined): string[] {
  const origin = configuredSupabaseOrigin(supabaseUrl);
  const withSupabase = (base: string) => (origin ? `${base} ${origin}` : base);

  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    withSupabase(
      "img-src 'self' data: blob: https://*.supabase.co https://lh3.googleusercontent.com https://avatars.githubusercontent.com",
    ),
    "font-src 'self' data:",
    withSupabase("connect-src 'self' https://*.supabase.co wss://*.supabase.co"),
    withSupabase("media-src 'self' blob: https://*.supabase.co"),
    "worker-src 'self'",
    "manifest-src 'self'",
    withSupabase("form-action 'self' https://*.supabase.co"),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ];
}

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
    {
      key: "Content-Security-Policy",
      value: [
        ...CSP_DIRECTIVES,
        ...(httpsOrigin ? ["upgrade-insecure-requests"] : []),
      ].join("; "),
    },
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

/**
 * Production (Vercel) is https, so it gets the full set. `next dev` is http by
 * definition. A production BUILD served over http is only ever the e2e harness,
 * which opts out explicitly via `VIZION_HTTP_ORIGIN=1` (set in
 * `playwright.config.ts`) — nothing else should ever set it.
 */
export const HTTPS_ORIGIN =
  process.env.NODE_ENV === "production" && process.env.VIZION_HTTP_ORIGIN !== "1";

const securityHeaders = buildSecurityHeaders(HTTPS_ORIGIN);

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
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // The service worker must never be cached so updates roll out immediately.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;

/**
 * Content-Security-Policy builder (P6 hardening; audit SEC-001 for the nonce).
 *
 * Pure and Edge-safe: consumed by BOTH the middleware (per-request nonce
 * policy for every document) and `next.config.ts` (static fallback policy for
 * the middleware-excluded PWA assets — offline.html and sw.js). Locks the app
 * to its own origin plus the configured Supabase project. Model-provider
 * calls are server-side only, so they never appear in `connect-src`. Fonts
 * are self-hosted via next/font, so no external font origin is needed.
 */

/**
 * The exact Supabase origin this deployment is configured against.
 *
 * Narrowed from the old `*.supabase.co` wildcard (audit SEC-001): with
 * `'unsafe-inline'` gone the wildcard's main risk was as an exfil channel —
 * ANY attacker-registered Supabase project was a valid `connect-src` target.
 * The exact origin closes that. The wildcard survives only as the fallback
 * for a build with no URL configured at all, where the policy cannot know
 * the project and must not brick auth.
 *
 * Returns null for an unparseable/missing URL (callers fall back) — and only
 * ever the ORIGIN: a stray path or query in the env value must never reach
 * the policy.
 */
export function configuredSupabaseOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const { origin, protocol } = new URL(raw);
    if (protocol !== "https:" && protocol !== "http:") return null;
    return origin;
  } catch {
    return null;
  }
}

/**
 * The WebSocket origin supabase-js will derive from that same URL.
 *
 * It builds its Realtime endpoint by rewriting the configured URL's protocol
 * (`https://host` → `wss://host`), and CSP does not follow it there: an
 * origin allowed for REST does NOT bring its own socket. Measured in both
 * engines — see the git history of next.config.ts for the probe table.
 */
export function derivedWebsocketOrigin(origin: string): string {
  return origin.replace(/^http/i, "ws");
}

/**
 * The directive list. With a `nonce`, `script-src` is nonce-based and
 * `'unsafe-inline'` is gone — the no-flash theme bootstrap and Next's own
 * inline scripts all carry the nonce (Next reads it from the request's CSP
 * header). Without one (the static fallback for offline.html/sw.js, whose
 * inline reload script cannot receive a per-request nonce), script-src keeps
 * `'unsafe-inline'` exactly as before.
 */
export function cspDirectives(supabaseUrl: string | undefined, nonce?: string): string[] {
  const origin = configuredSupabaseOrigin(supabaseUrl);
  // Exact project origin when configured; the hosted wildcard only as the
  // no-config fallback.
  const httpSrc = origin ?? "https://*.supabase.co";
  const wsSrc = origin ? derivedWebsocketOrigin(origin) : "wss://*.supabase.co";

  return [
    "default-src 'self'",
    nonce ? `script-src 'self' 'nonce-${nonce}'` : "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${httpSrc} https://lh3.googleusercontent.com https://avatars.githubusercontent.com`,
    "font-src 'self' data:",
    `connect-src 'self' ${httpSrc} ${wsSrc}`,
    `media-src 'self' blob: ${httpSrc}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    `form-action 'self' ${httpSrc}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ];
}

/** One policy string, with the https-only upgrade directive when applicable. */
export function buildCsp(
  supabaseUrl: string | undefined,
  opts: { nonce?: string; httpsOrigin: boolean },
): string {
  return [
    ...cspDirectives(supabaseUrl, opts.nonce),
    ...(opts.httpsOrigin ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/**
 * Whether this instance serves https (production semantics). `next dev` is
 * http by definition; a production BUILD served over http is only ever the
 * e2e harness, which opts out explicitly via `VIZION_HTTP_ORIGIN=1`.
 * See next.config.ts for why the two https-only headers must not ship on
 * plain-http origins.
 */
export function isHttpsOrigin(): boolean {
  return process.env.NODE_ENV === "production" && process.env.VIZION_HTTP_ORIGIN !== "1";
}

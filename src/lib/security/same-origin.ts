import type { NextRequest } from "next/server";

/**
 * Cross-origin guard for state-changing route handlers (audit SEC-010).
 *
 * Next's built-in origin check covers server ACTIONS only — route handlers
 * ride nothing but the library-default `SameSite=Lax` cookie, which one
 * unrelated cookieOptions change would silently remove. An Origin header
 * that disagrees with the request's own origin is a cross-site POST; an
 * ABSENT Origin is tolerated (same-origin legacy UAs omit it, and a forged
 * request that strips Origin still carries no Lax cookie).
 */
export function crossOriginPost(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin !== request.nextUrl.origin;
}

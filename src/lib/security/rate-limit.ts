/**
 * Fixed-window rate limiter (P6 hardening). A best-effort per-instance burst
 * guard that sits in front of the authoritative per-user DB cost/rate window —
 * it absorbs rapid bursts cheaply without a DB round trip. Pure core (inject the
 * store + clock) so it is unit-tested; the module-level store is the default.
 *
 * Note: serverless instances don't share memory, so this is a coarse layer, not
 * the source of truth. The DB `usage_window` cap is the durable enforcement.
 */

interface Hit {
  count: number;
  resetAt: number;
}

export interface RateResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

const defaultStore = new Map<string, Hit>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
  store: Map<string, Hit> = defaultStore,
): RateResult {
  const hit = store.get(key);
  if (!hit || now >= hit.resetAt) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }
  if (hit.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: hit.resetAt };
  }
  hit.count += 1;
  return { allowed: true, remaining: limit - hit.count, resetAt: hit.resetAt };
}

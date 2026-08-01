import { rateLimit } from "@/lib/security/rate-limit";

/**
 * Burst guard for non-model endpoints and mutating server actions (audit
 * SEC-002 — CLAUDE.md §9 promises "rate limits on all endpoints", and only
 * the two model routes had any). Same in-memory limiter as the model routes:
 * a per-instance ADVISORY layer, not the source of truth — the durable
 * cross-instance limits stay on the model routes' `spend_reserve`, which is
 * where the money is. These buckets exist to blunt scripted bursts cheaply.
 */
export const RATE_LIMITED_MESSAGE = "You're going fast — wait a moment and try again.";

/** Generous per-user write budget — humans never hit this. */
const WRITES_PER_MIN = 30;
/** Email-sending actions get a tighter lid (each call sends real mail). */
const EMAILS_PER_HOUR = 5;

/** True when this user's write burst budget for the bucket is exhausted. */
export function writeLimited(userId: string, bucket: string): boolean {
  return !rateLimit(`${bucket}:${userId}`, WRITES_PER_MIN, 60_000).allowed;
}

/** True when this user's email-sending budget is exhausted. */
export function emailLimited(userId: string, bucket: string): boolean {
  return !rateLimit(`${bucket}:${userId}`, EMAILS_PER_HOUR, 3_600_000).allowed;
}

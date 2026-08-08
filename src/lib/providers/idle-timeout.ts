import "server-only";
import {
  PROVIDER_IDLE_MS,
  PROVIDER_TOTAL_MS,
  type Provider,
} from "@/lib/providers/config";
import { ProviderError } from "@/lib/providers/errors";

/**
 * Bound a provider stream on SILENCE, with a real whole-stream backstop.
 *
 * WHAT THE SDK `timeout` ACTUALLY DOES — measured, not assumed
 * ------------------------------------------------------------
 * An earlier version of this file claimed the SDKs' `timeout` option is a
 * whole-request deadline covering the streamed body read. **It is not**, and
 * the correction matters enough to record: in both vendored SDKs the timer is
 * armed around `fetch()` and cleared the moment that promise settles —
 * `openai/src/core.ts:597-602` (`.finally(() => clearTimeout(timeout))`) and
 * `@anthropic-ai/sdk/src/client.ts:729-733` (`try { return await this.fetch(…) }
 * finally { clearTimeout(timeout) }`). A streaming `fetch()` resolves at the
 * RESPONSE HEADERS; the body is consumed afterwards. So `timeout` bounds
 * connect-and-headers only, and once the first byte lands nothing in the SDK
 * bounds the stream at all.
 *
 * Two consequences, and they point in opposite directions:
 *
 *  1. The old `PROVIDER_TIMEOUT_MS = 55_000` was NOT what truncated long runs
 *     mid-body. It could not have been. The route's `maxDuration = 60` was —
 *     the platform killing the whole function — which is why the fix is
 *     primarily the raised window, and why raising it is not optional.
 *  2. Passing `PROVIDER_TOTAL_MS` as the SDK `timeout` does NOT give a total
 *     backstop either. A continuously productive stream would sail past it and
 *     be killed by the platform instead, skipping the route's finally-block and
 *     stranding the spend hold — precisely the PRV-002 leak the policy exists
 *     to prevent.
 *
 * So the total deadline lives HERE, as an absolute wall measured across the
 * whole stream lifetime, independent of how often chunks arrive. The SDK
 * `timeout` is kept for what it genuinely covers (a hang before headers).
 *
 * THE IDLE RULE
 * -------------
 * Reset the clock on every chunk. A stream that keeps producing is never
 * interrupted, however long it runs; a stream that goes quiet for `idleMs` is
 * dead and is cut. Between the two, `totalMs` is sized under the route's
 * `maxDuration` so the finally-block always runs.
 *
 * WHY `cancel` IS NOT OPTIONAL IN PRACTICE (the subtle part)
 * ----------------------------------------------------------
 * Cancellation cannot go through `iterator.return()` alone. Both SDKs implement
 * `[Symbol.asyncIterator]` as an **async generator**, and the async-generator
 * protocol QUEUES a `return()` request behind an already-pending `next()`. At
 * the moment we idle out there is by definition a `next()` in flight — that is
 * what the silence is — so `await iterator.return()` would not settle until the
 * upstream read finally produced something or the 285s SDK deadline fired.
 *
 * That would have made the idle timeout decorative: the error could not
 * propagate, the connection stayed open, and the route could be left with
 * seconds of its `maxDuration` in which to settle the spend hold. So the
 * caller passes `cancel` — the SDK's own abort handle (`stream.controller
 * .abort()` / `MessageStream.abort()`) — which aborts the underlying HTTP
 * request, settles the pending read, and lets the queued `return()` run.
 *
 * The `return()` is still awaited afterwards, so the generator's own `finally`
 * blocks get to run, but it is raced against a short grace period: a cleanup
 * path that can block forever is exactly what this function exists to prevent.
 */
const CLEANUP_GRACE_MS = 2_000;

export interface IdleTimeoutOptions {
  /**
   * Abort the underlying request. Required for any SDK-backed stream — see the
   * async-generator queueing note above. Omit only for a source whose
   * `return()` can settle independently of a pending `next()`.
   */
  cancel?: () => void;
  /** Silence budget. Defaults to PROVIDER_IDLE_MS. */
  idleMs?: number;
  /**
   * ABSOLUTE epoch-ms wall for the whole call, which callers must take with
   * `providerDeadline()` BEFORE issuing the request.
   *
   * Not a duration, and the distinction is the bug it fixes. Most adapters
   * `await client.chat.completions.create(...)` — which resolves at the
   * response HEADERS — and only then start iterating. A duration measured from
   * the wrapper's first call therefore excludes header latency, giving the
   * request two independent budgets (headers, then stream) that can sum to
   * well past the route's `maxDuration`. One wall, taken before the request,
   * cannot be split that way.
   */
  deadline?: number;
  /** Relative budget, for callers with nothing to await first (and tests).
   *  Ignored when `deadline` is given. */
  totalMs?: number;
}

/** One absolute wall for a provider call. Take it BEFORE issuing the request,
 *  so header latency is inside the budget rather than beside it. */
export function providerDeadline(totalMs: number = PROVIDER_TOTAL_MS): number {
  return Date.now() + totalMs;
}

export async function* withIdleTimeout<T>(
  source: AsyncIterable<T>,
  provider: Provider,
  {
    cancel,
    idleMs = PROVIDER_IDLE_MS,
    totalMs = PROVIDER_TOTAL_MS,
    deadline: absoluteDeadline,
  }: IdleTimeoutOptions = {},
): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();
  const deadline = absoluteDeadline ?? Date.now() + totalMs;
  try {
    for (;;) {
      // One timer per iteration, set to whichever wall comes first. The total
      // is absolute — it does NOT reset on a chunk, which is the whole point:
      // a stream that never goes quiet must still be bounded.
      const remainingTotal = deadline - Date.now();
      const expiringTotal = remainingTotal <= idleMs;
      const waitMs = Math.max(0, Math.min(idleMs, remainingTotal));

      const next = iterator.next();
      // The race abandons whichever promise loses. If `next` later rejects
      // with nobody awaiting it, Node reports an unhandled rejection and (on
      // some configs) tears down the process — so it always keeps a handler.
      next.catch(() => {});

      let timer: ReturnType<typeof setTimeout> | undefined;
      const expiry = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new ProviderError(
                provider,
                expiringTotal
                  ? `The ${provider} request exceeded its total time budget and was stopped.`
                  : `The ${provider} stream went quiet for ${Math.round(idleMs / 1000)}s and was stopped.`,
                504,
              ),
            ),
          waitMs,
        );
      });

      let result: IteratorResult<T>;
      try {
        result = await Promise.race([next, expiry]);
      } finally {
        clearTimeout(timer);
      }

      if (result.done) return;
      yield result.value;
    }
  } finally {
    // Reached on normal completion, on idle-out, and on consumer break/throw.
    // Abort FIRST: on the idle path a read is still pending, and the queued
    // `return()` cannot run until it settles.
    try {
      cancel?.();
    } catch {
      /* already torn down */
    }
    // Then let the source run its own cleanup — but never wait forever for it.
    if (iterator.return) {
      let graceTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          iterator.return().catch(() => undefined),
          new Promise<void>((resolve) => {
            graceTimer = setTimeout(resolve, CLEANUP_GRACE_MS);
          }),
        ]);
      } finally {
        clearTimeout(graceTimer);
      }
    }
  }
}

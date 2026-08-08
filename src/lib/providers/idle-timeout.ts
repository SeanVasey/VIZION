import "server-only";
import { PROVIDER_IDLE_MS, type Provider } from "@/lib/providers/config";
import { ProviderError } from "@/lib/providers/errors";

/**
 * Bound a provider stream on SILENCE rather than on total elapsed time.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every adapter used to pass one `PROVIDER_TIMEOUT_MS = 55_000` as the SDK
 * client's `timeout`. In both the Anthropic and OpenAI Node SDKs that option is
 * a whole-request deadline that COVERS THE STREAMED BODY READ — it is not a
 * connect or first-byte timeout. So it could not distinguish a hung connection
 * from a healthy generation that is simply long, and it killed both at 55s.
 *
 * The effect was that the clock, not `max_tokens`, was the real output ceiling:
 * ~2,000-4,000 tokens at typical streaming rates, against the 16,000-64,000 the
 * adapters actually ask for. Worse, the run was still billed — the route's
 * finally-block estimates from `streamedChars` and settles the ledger — so a
 * truncated answer cost real money. That is the bug this file fixes.
 *
 * The rule here: reset the clock on every chunk. A stream that keeps producing
 * is never interrupted, however long it runs; a stream that goes quiet for
 * `idleMs` is dead and is cut. The total-elapsed backstop stays on the SDK
 * client (`PROVIDER_TOTAL_MS`), sized under the route's `maxDuration` so the
 * finally-block always runs and the spend hold is never stranded.
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
}

export async function* withIdleTimeout<T>(
  source: AsyncIterable<T>,
  provider: Provider,
  { cancel, idleMs = PROVIDER_IDLE_MS }: IdleTimeoutOptions = {},
): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = iterator.next();
      // The race abandons whichever promise loses. If `next` later rejects
      // with nobody awaiting it, Node reports an unhandled rejection and (on
      // some configs) tears down the process — so it always keeps a handler.
      next.catch(() => {});

      let timer: ReturnType<typeof setTimeout> | undefined;
      const idle = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new ProviderError(
                provider,
                `The ${provider} stream went quiet for ${Math.round(idleMs / 1000)}s and was stopped.`,
                504,
              ),
            ),
          idleMs,
        );
      });

      let result: IteratorResult<T>;
      try {
        result = await Promise.race([next, idle]);
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

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
 * Cancellation matters as much as the timeout. On idle-out — and on any early
 * exit by the consumer, including `break` and a thrown error — the source
 * iterator's `return()` is called, which is what tells the SDK to abort the
 * underlying HTTP request. Without it the connection would keep draining
 * tokens we are no longer reading, and keep billing for them.
 */
export async function* withIdleTimeout<T>(
  source: AsyncIterable<T>,
  provider: Provider,
  idleMs: number = PROVIDER_IDLE_MS,
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
    // `return()` is optional on the iterator protocol and may itself reject if
    // the transport is already gone; neither case should mask the real error.
    try {
      await iterator.return?.();
    } catch {
      /* the stream is being torn down either way */
    }
  }
}

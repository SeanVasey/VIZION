import { describe, expect, it } from "vitest";
import { ProviderError } from "@/lib/providers/errors";
import { withIdleTimeout } from "@/lib/providers/idle-timeout";

/**
 * The regression under test, stated once.
 *
 * Every adapter used to bound its provider call with a single 55s SDK
 * `timeout`. In the Anthropic and OpenAI Node SDKs that option is a
 * WHOLE-REQUEST deadline covering the streamed body read, so it could not tell
 * a hung connection from a healthy generation that was simply long — and it
 * killed both. The clock, not `max_tokens`, became the real output ceiling
 * (~2,000-4,000 tokens against a requested 16,000-64,000), and the truncated
 * run was still billed.
 *
 * So the property that matters is not "it times out". It is that TOTAL ELAPSED
 * TIME DOES NOT MATTER — only silence does.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A stream that emits `count` chunks, `gapMs` apart. */
async function* ticker(count: number, gapMs: number): AsyncGenerator<number> {
  for (let i = 0; i < count; i++) {
    await sleep(gapMs);
    yield i;
  }
}

describe("withIdleTimeout", () => {
  it("passes a healthy stream through unchanged", async () => {
    const seen: number[] = [];
    for await (const v of withIdleTimeout(ticker(4, 1), "anthropic", { idleMs: 200 })) {
      seen.push(v);
    }
    expect(seen).toEqual([0, 1, 2, 3]);
  });

  it("does NOT fire when total elapsed exceeds the budget but no single gap does", async () => {
    // THE bug, in miniature: 8 chunks × 20ms = ~160ms of streaming under an
    // 80ms idle budget. A whole-request deadline of 80ms would have killed
    // this at chunk 4. Silence never reaches 80ms, so nothing is cut.
    const seen: number[] = [];
    for await (const v of withIdleTimeout(ticker(8, 20), "anthropic", { idleMs: 80 })) {
      seen.push(v);
    }
    expect(seen).toHaveLength(8);
  });

  it("fires when the stream actually goes quiet, as a 504 ProviderError", async () => {
    const run = async () => {
      for await (const v of withIdleTimeout(ticker(3, 200), "openai", { idleMs: 50 })) {
        void v;
      }
    };
    await expect(run()).rejects.toThrow(ProviderError);
    await expect(run()).rejects.toMatchObject({ provider: "openai", status: 504 });
  });

  it("stops a CONTINUOUSLY PRODUCTIVE stream at the total wall", async () => {
    // The gap Codex found (PR #91, second P1). The total budget cannot live on
    // the SDK client: both vendored SDKs clear that timer when fetch() settles
    // — which for a stream is at the response HEADERS, before the body is read
    // (openai/src/core.ts:597-602, @anthropic-ai/sdk/src/client.ts:729-733).
    // So a stream that never goes quiet had NO bound at all and would run
    // until the platform killed the function, skipping the route's finally
    // block and stranding the spend hold. The wall is absolute: unlike the
    // idle timer it must not reset on a chunk.
    let cancelled = false;
    const seen: number[] = [];
    await expect(
      (async () => {
        // Chunks every 5ms — silence never approaches the 200ms idle budget.
        for await (const v of withIdleTimeout(ticker(1_000, 5), "meta", {
          idleMs: 200,
          totalMs: 120,
          cancel: () => {
            cancelled = true;
          },
        })) {
          seen.push(v);
        }
      })(),
    ).rejects.toThrow(/request budget/);

    expect(cancelled).toBe(true);
    // It really was producing the whole time — this is not an idle-out wearing
    // a different message.
    expect(seen.length).toBeGreaterThan(5);
  });

  it("does not let the total wall reset when chunks keep arriving", async () => {
    // Same distinction, stated as a bound: with a 120ms wall and 5ms chunks,
    // a wall that reset per chunk would never fire at all.
    const started = Date.now();
    await expect(
      (async () => {
        for await (const v of withIdleTimeout(ticker(1_000, 5), "zai", {
          idleMs: 5_000,
          totalMs: 120,
        })) {
          void v;
        }
      })(),
    ).rejects.toThrow(/request budget/);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("aborts a REAL async generator promptly — return() alone would deadlock", async () => {
    // The regression this pins (Codex review, PR #91). Both SDKs implement
    // [Symbol.asyncIterator] as an async generator, and the async-generator
    // protocol QUEUES return() behind an already-pending next(). At idle-out
    // there is always a next() in flight — that is what the silence IS — so
    // awaiting return() would block until the upstream read settled or the
    // 285s SDK deadline fired, making the idle timeout decorative.
    //
    // An object literal with an independently-resolving return() cannot show
    // this. It has to be a genuine `async function*` suspended at an await.
    let aborted = false;
    const gate = new AbortController();
    async function* sdkLike(): AsyncGenerator<number> {
      yield 0;
      // Suspended here, exactly like a stream waiting on the next SSE frame.
      await new Promise<void>((resolve) => {
        gate.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      yield 1;
    }

    const started = Date.now();
    await expect(
      (async () => {
        for await (const v of withIdleTimeout(sdkLike(), "qwen", {
          idleMs: 40,
          // Stands in for `stream.controller.abort()`: settles the pending
          // read so the queued return() can run.
          cancel: () => {
            aborted = true;
            gate.abort();
          },
        })) {
          void v;
        }
      })(),
    ).rejects.toMatchObject({ status: 504 });

    expect(aborted).toBe(true);
    // Without the cancel it would hang to the 2s cleanup grace at best.
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("does not hang forever when a source's cleanup never settles", async () => {
    // Defence in depth: a cleanup path that can block indefinitely is exactly
    // what this module exists to prevent, so return() is raced against a
    // grace period even when no cancel is supplied.
    const source: AsyncIterable<number> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          await sleep(10_000);
          return { value: 1, done: false };
        },
        return: () => new Promise<IteratorResult<number>>(() => {}),
      }),
    };
    const started = Date.now();
    await expect(
      (async () => {
        for await (const v of withIdleTimeout(source, "zai", { idleMs: 20 })) void v;
      })(),
    ).rejects.toThrow(ProviderError);
    expect(Date.now() - started).toBeLessThan(4_000);
  }, 10_000);

  it("cancels the source when the CONSUMER stops early", async () => {
    // A `break` in the adapter (or a thrown error downstream) must release the
    // provider connection too — same reason, different exit.
    let returned = false;
    let cancelled = false;
    async function* counted(): AsyncGenerator<number> {
      try {
        for (let i = 0; ; i++) yield i;
      } finally {
        returned = true;
      }
    }
    for await (const v of withIdleTimeout(counted(), "xai", {
      idleMs: 500,
      cancel: () => {
        cancelled = true;
      },
    })) {
      if (v === 2) break;
    }
    expect(returned).toBe(true);
    expect(cancelled).toBe(true);
  });

  it("surfaces a source error as itself, not as a timeout", async () => {
    async function* broken(): AsyncGenerator<number> {
      yield 1;
      throw new Error("upstream exploded");
    }
    const run = async () => {
      for await (const v of withIdleTimeout(broken(), "mistral", { idleMs: 500 })) void v;
    };
    await expect(run()).rejects.toThrow("upstream exploded");
  });
});

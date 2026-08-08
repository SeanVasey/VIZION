import { describe, expect, it } from "vitest";
import { ProviderError } from "@/lib/providers/errors";
import {
  providerBudget,
  providerDeadline,
  remainingMs,
  withIdleTimeout,
} from "@/lib/providers/idle-timeout";

/**
 * What this module has to get right, stated once.
 *
 * The SDKs' `timeout` option bounds connect-and-headers only: both vendored
 * SDKs arm the timer around fetch() and clear it when that promise settles
 * (openai/src/core.ts:597-602, @anthropic-ai/sdk/src/client.ts:729-733), and a
 * streaming fetch() resolves at the RESPONSE HEADERS. Once the body streams the
 * SDK bounds nothing, so BOTH budgets are enforced here:
 *
 *   IDLE  — resets on every chunk. A stream that keeps producing is never cut.
 *   TOTAL — an absolute wall that must NOT reset, taken before the request so
 *           header latency is inside it rather than beside it.
 *
 * They look alike and do opposite jobs, which is why each is pinned separately.
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
    ).rejects.toThrow(/total time budget/);

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
    ).rejects.toThrow(/total time budget/);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("counts time spent BEFORE iteration against the same wall", async () => {
    // Codex's fourth finding (PR #91). Adapters `await client.chat.completions
    // .create(...)` — which resolves at the response HEADERS — and only then
    // start iterating. A budget measured from the wrapper's first call would
    // exclude that header wait, handing the request two independent budgets
    // that can sum past the route's maxDuration and skip its spend-settling
    // finally block. An absolute deadline taken before the request cannot be
    // split that way.
    const deadline = providerDeadline(100);
    await sleep(120); // the "header wait" alone already exhausts it
    const started = Date.now();
    await expect(
      (async () => {
        for await (const v of withIdleTimeout(ticker(100, 5), "openai", {
          idleMs: 5_000,
          deadline,
        })) {
          void v;
        }
      })(),
    ).rejects.toThrow(/total time budget/);
    // Fires ~immediately: the budget was already spent before we started.
    expect(Date.now() - started).toBeLessThan(200);
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

/**
 * The budget helper — what actually ends the PR #91 loop.
 *
 * Six review rounds each RELOCATED the total timer (route preflight, header
 * wait, stream body, SDK client) while the layer below went on arming a fresh
 * full-length one from `PROVIDER_TOTAL_MS`. Two budgets that each read 285s do
 * not sum to 285s. The cure is that below the route there is no duration left
 * to relocate: adapters get a wall and ask it what remains.
 */
describe("providerBudget", () => {
  it("keeps the caller's wall and derives the timeout from what REMAINS", async () => {
    // The property, stated directly: the SDK timeout shrinks as the wall is
    // consumed. A constant would return the same number both times, which is
    // exactly how the header wait got a full-length budget beside the stream's.
    const wall = providerDeadline(5_000);
    const first = providerBudget("openai", wall);
    expect(first.deadline).toBe(wall);
    expect(first.timeoutMs).toBeLessThanOrEqual(5_000);
    expect(first.timeoutMs).toBeGreaterThan(4_000);

    await sleep(1_200);
    const second = providerBudget("openai", wall);
    expect(second.deadline).toBe(wall);
    // Same wall, strictly smaller budget — series, not parallel.
    expect(second.timeoutMs).toBeLessThan(first.timeoutMs - 1_000);
  });

  it("refuses to issue a request whose budget is already spent", () => {
    // Not defensive rounding. A call we start and must instantly abort can
    // still be BILLED once the provider begins generating, so a preflight that
    // ate the whole window must fail BEFORE the connection, not after it.
    expect(() => providerBudget("anthropic", Date.now() - 1)).toThrow(ProviderError);
    try {
      providerBudget("anthropic", Date.now() - 1);
    } catch (e) {
      expect(e).toMatchObject({ provider: "anthropic", status: 504 });
      expect((e as Error).message).toMatch(/no time budget left/);
    }
  });

  it("takes a fresh wall when the caller offers none, for direct/adapter use", () => {
    const { deadline, timeoutMs } = providerBudget("zai");
    expect(deadline).toBeGreaterThan(Date.now());
    expect(timeoutMs).toBeGreaterThan(0);
  });

  it("clamps a spent wall at zero rather than reporting negative time", () => {
    expect(remainingMs(Date.now() - 10_000)).toBe(0);
    expect(remainingMs(Date.now() + 5_000)).toBeGreaterThan(4_000);
  });
});

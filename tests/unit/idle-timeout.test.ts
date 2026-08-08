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
    for await (const v of withIdleTimeout(ticker(4, 1), "anthropic", 200)) {
      seen.push(v);
    }
    expect(seen).toEqual([0, 1, 2, 3]);
  });

  it("does NOT fire when total elapsed exceeds the budget but no single gap does", async () => {
    // THE bug, in miniature: 8 chunks × 20ms = ~160ms of streaming under an
    // 80ms idle budget. A whole-request deadline of 80ms would have killed
    // this at chunk 4. Silence never reaches 80ms, so nothing is cut.
    const seen: number[] = [];
    for await (const v of withIdleTimeout(ticker(8, 20), "anthropic", 80)) {
      seen.push(v);
    }
    expect(seen).toHaveLength(8);
  });

  it("fires when the stream actually goes quiet, as a 504 ProviderError", async () => {
    const run = async () => {
      for await (const v of withIdleTimeout(ticker(3, 200), "openai", 50)) {
        void v;
      }
    };
    await expect(run()).rejects.toThrow(ProviderError);
    await expect(run()).rejects.toMatchObject({ provider: "openai", status: 504 });
  });

  it("cancels the source when it idles out, so the connection is released", async () => {
    // Without this the upstream request keeps streaming tokens nobody reads —
    // and keeps billing for them. `return()` is what aborts the HTTP request.
    let returned = false;
    const source: AsyncIterable<number> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          await sleep(1_000);
          return { value: 1, done: false };
        },
        return: async () => {
          returned = true;
          return { value: undefined, done: true as const };
        },
      }),
    };
    await expect(
      (async () => {
        for await (const v of withIdleTimeout(source, "qwen", 30)) void v;
      })(),
    ).rejects.toThrow(ProviderError);
    expect(returned).toBe(true);
  });

  it("cancels the source when the CONSUMER stops early", async () => {
    // A `break` in the adapter (or a thrown error downstream) must release the
    // provider connection too — same reason, different exit.
    let returned = false;
    async function* counted(): AsyncGenerator<number> {
      try {
        for (let i = 0; ; i++) yield i;
      } finally {
        returned = true;
      }
    }
    for await (const v of withIdleTimeout(counted(), "xai", 500)) {
      if (v === 2) break;
    }
    expect(returned).toBe(true);
  });

  it("surfaces a source error as itself, not as a timeout", async () => {
    async function* broken(): AsyncGenerator<number> {
      yield 1;
      throw new Error("upstream exploded");
    }
    const run = async () => {
      for await (const v of withIdleTimeout(broken(), "mistral", 500)) void v;
    };
    await expect(run()).rejects.toThrow("upstream exploded");
  });
});

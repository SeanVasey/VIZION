import { describe, expect, it, vi } from "vitest";

/**
 * Salvage + stop-reason behavior of enhanceStream (2026-07 incident): a run
 * whose output string demonstrably completed must never be discarded over a
 * malformed envelope tail, and a truncated run must say "length limit", not
 * "non-JSON".
 */
vi.mock("@/lib/providers/anthropic", () => ({ streamAnthropic: vi.fn() }));
vi.mock("@/lib/providers/openai", () => ({ streamOpenAI: vi.fn() }));
vi.mock("@/lib/providers/google", () => ({ streamGoogle: vi.fn() }));
vi.mock("@/lib/providers/mistral", () => ({ streamMistral: vi.fn() }));
vi.mock("@/lib/providers/xai", () => ({ streamXAI: vi.fn() }));

import { streamAnthropic } from "@/lib/providers/anthropic";
import type { ProviderStreamChunk } from "@/lib/providers/errors";

const ARGS = { input: "hi", mode: "clarify", target: "sonnet_5" } as const;

function feed(...chunks: ProviderStreamChunk[]) {
  vi.mocked(streamAnthropic).mockImplementation(async function* () {
    for (const c of chunks) yield c;
  });
}

async function drain() {
  const { enhanceStream } = await import("@/lib/providers/adapter");
  const events = [];
  for await (const e of enhanceStream(ARGS)) events.push(e);
  return events;
}

describe("enhanceStream salvage + stop reasons", () => {
  it("salvages a completed output when the envelope tail is malformed", async () => {
    // The rationale value never arrives — JSON.parse fails, but the output
    // string closed. The paid result survives with an empty rationale.
    feed(
      { text: '{"output":"A finished prompt.","rationale":' },
      { usage: { tokenIn: 10, tokenOut: 8 } },
    );
    const events = await drain();
    const done = events.at(-1);
    if (done?.type !== "done") throw new Error("expected a done event");
    expect(done.result.output).toBe("A finished prompt.");
    expect(done.result.rationale).toBe("");
    expect(done.result.salvaged).toBe(true);
  });

  it("does not mark a run salvaged when tolerant parsing already handles it", async () => {
    // A fenced envelope parses via the fence unwrap — the real rationale
    // survives and no salvage flag rides along.
    feed({ text: '```json\n{"output":"ok","rationale":"why"}\n```' });
    const events = await drain();
    const done = events.at(-1);
    if (done?.type !== "done") throw new Error("expected a done event");
    expect(done.result.rationale).toBe("why");
    expect(done.result.salvaged).toBeUndefined();
  });

  it("KEEPS the partial when the provider hit its length limit — it was paid for", async () => {
    // This used to throw, discarding every token that had streamed. The run
    // is billed either way (the route's finally-block settles from
    // streamedChars), so throwing charged the user for a result they could
    // not keep. The partial rides out flagged `truncated` — which is NOT
    // `salvaged`: salvage promises a complete output, truncation cannot, and
    // the two carry different copy in the result view.
    feed({ text: '{"output":"cut off mid-sente' }, { stopReason: "max_tokens" });
    const events = await drain();
    const done = events.at(-1);
    if (done?.type !== "done") throw new Error("expected a done event");
    expect(done.result.output).toBe("cut off mid-sente");
    expect(done.result.truncated).toBe(true);
    expect(done.result.rationale).toBe("");
    // Mutually exclusive, and this is the assertion that matters: the salvage
    // branch's copy reads "the prompt above is complete", so a run flagged
    // both would render that immediately above "the prompt above is
    // incomplete" and tell the user two opposite things about one result.
    expect(done.result.salvaged).toBeUndefined();
  });

  it("still throws on a length stop when nothing usable streamed", async () => {
    // No partial to keep, so the error is still the honest answer — a `done`
    // carrying an empty output would render as a successful empty prompt.
    feed({ text: '{"output":"' }, { stopReason: "max_tokens" });
    const { enhanceStream } = await import("@/lib/providers/adapter");
    const run = async () => {
      for await (const e of enhanceStream(ARGS)) void e;
    };
    await expect(run()).rejects.toThrow(
      "The model hit its length limit before finishing. Try a lower thinking level or a shorter prompt.",
    );
  });

  it("keeps the original parse error when the output never completed without a length stop", async () => {
    feed({ text: '{"output":"cut off mid-sente' }, { stopReason: "end_turn" });
    const { enhanceStream } = await import("@/lib/providers/adapter");
    const run = async () => {
      for await (const e of enhanceStream(ARGS)) void e;
    };
    await expect(run()).rejects.toThrow("The model returned a non-JSON response.");
  });

  it("stop-reason chunks emit no delta or usage events of their own", async () => {
    feed({ text: '{"output":"ok","rationale":"r"}' }, { stopReason: "end_turn" });
    const events = await drain();
    // One delta run for the decoded output, then done — nothing extra for
    // the stop-reason chunk.
    expect(events.filter((e) => e.type === "usage")).toHaveLength(0);
    expect(events.at(-1)?.type).toBe("done");
  });
});

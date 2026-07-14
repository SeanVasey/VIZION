import { describe, it, expect, vi } from "vitest";
import { createEnvelopeScanner } from "@/lib/providers/json-stream";
import {
  encodeSseEvent,
  parseSseStream,
  type EnhanceStreamEvent,
} from "@/lib/enhance/stream-events";

/** Feed a string into a scanner in chunks of the given size. */
function scanChunked(raw: string, size: number, field = "output"): string {
  const scanner = createEnvelopeScanner(field);
  let out = "";
  for (let i = 0; i < raw.length; i += size) {
    out += scanner.push(raw.slice(i, i + size));
  }
  return out;
}

describe("createEnvelopeScanner", () => {
  const envelope = '{"output": "Write a haiku.", "rationale": "Short."}';

  it("extracts the output field from a whole envelope", () => {
    const scanner = createEnvelopeScanner();
    expect(scanner.push(envelope)).toBe("Write a haiku.");
    expect(scanner.done).toBe(true);
  });

  it("extracts identically for every chunking of the same text", () => {
    for (const size of [1, 2, 3, 5, 7, 100]) {
      expect(scanChunked(envelope, size)).toBe("Write a haiku.");
    }
  });

  it("stops at the closing quote and ignores the rationale", () => {
    const scanner = createEnvelopeScanner();
    const out = scanner.push('{"output":"done","rationale":"leaked?"}');
    expect(out).toBe("done");
    expect(scanner.push('more"garbage')).toBe("");
  });

  it("decodes simple escapes", () => {
    const raw = '{"output":"line1\\nline2\\t\\"quoted\\" back\\\\slash"}';
    expect(scanChunked(raw, 1)).toBe('line1\nline2\t"quoted" back\\slash');
  });

  it("decodes unicode escapes, including surrogate pairs, split across chunks", () => {
    const raw = '{"output":"em\\u2014dash \\uD83D\\uDE00 done"}';
    for (const size of [1, 2, 3, 4, 5]) {
      expect(scanChunked(raw, size)).toBe("em—dash \u{1F600} done");
    }
  });

  it("finds the output key when it is not the first field", () => {
    const raw = '{"rationale":"the output: \\"fake\\"","output":"real text"}';
    // Keys are matched structurally (`"output"` + colon + quote), so the
    // similar-looking text INSIDE the rationale string can't false-match…
    expect(scanChunked(raw, 3)).toBe("real text");
  });

  it("handles whitespace and newlines around the key", () => {
    expect(scanChunked('{\n  "output" :\n  "spaced"\n}', 2)).toBe("spaced");
  });

  it("returns nothing when the key never arrives (unterminated/missing)", () => {
    const scanner = createEnvelopeScanner();
    expect(scanner.push('{"rationale":"only"}')).toBe("");
    expect(scanner.done).toBe(false);
  });

  it("passes unknown escapes through literally", () => {
    expect(scanChunked('{"output":"odd\\qescape"}', 1)).toBe("odd\\qescape");
  });
});

function sseBody(frames: string[], chunkSize = 7): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const whole = frames.join("");
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < whole.length; i += chunkSize) {
        controller.enqueue(encoder.encode(whole.slice(i, i + chunkSize)));
      }
      controller.close();
    },
  });
}

describe("SSE encode/parse round-trip", () => {
  it("round-trips a full event ladder across arbitrary chunk boundaries", async () => {
    const events: EnhanceStreamEvent[] = [
      { type: "status", step: "connecting", label: "Reaching the model…" },
      { type: "delta", text: "Hello " },
      { type: "delta", text: "world\nwith newline" },
      { type: "usage", tokenIn: 12, tokenOut: 34, costUsd: 0.0005 },
      {
        type: "done",
        result: {
          output: "Hello world",
          rationale: "r",
          diff: [],
          tokenIn: 12,
          tokenOut: 34,
          modelUsed: "m",
          costUsd: 0.0005,
          usage: { todayCost: 0.01, capUsd: 2 },
        },
      },
    ];
    for (const chunkSize of [1, 3, 7, 1000]) {
      const body = sseBody(events.map(encodeSseEvent), chunkSize);
      const parsed: EnhanceStreamEvent[] = [];
      for await (const e of parseSseStream(body)) parsed.push(e);
      expect(parsed).toEqual(events);
    }
  });

  it("skips garbled frames without dropping the rest", async () => {
    const good: EnhanceStreamEvent = { type: "delta", text: "kept" };
    const body = sseBody(["data: {broken\n\n", encodeSseEvent(good), ": comment\n\n"]);
    const parsed: EnhanceStreamEvent[] = [];
    for await (const e of parseSseStream(body)) parsed.push(e);
    expect(parsed).toEqual([good]);
  });
});

// --- adapter: enhanceStream decodes the envelope; enhance() is its drain ---

vi.mock("@/lib/providers/anthropic", () => ({
  streamAnthropic: async function* () {
    // The envelope arrives in awkward pieces, one splitting an escape.
    yield { usage: { tokenIn: 21, tokenOut: 0 } };
    yield { text: '{"output": "Enh' };
    yield { text: 'anced\\nprompt", "rat' };
    yield { text: 'ionale": "Because."}' };
    yield { usage: { tokenIn: 21, tokenOut: 9 } };
  },
}));
vi.mock("@/lib/providers/openai", () => ({ streamOpenAI: vi.fn() }));
vi.mock("@/lib/providers/google", () => ({ streamGoogle: vi.fn() }));
vi.mock("@/lib/providers/mistral", () => ({ streamMistral: vi.fn() }));
vi.mock("@/lib/providers/xai", () => ({ streamXAI: vi.fn() }));

describe("enhanceStream / enhance", () => {
  it("yields decoded deltas + usage, then a done result matching the buffered drain", async () => {
    const { enhanceStream, enhance } = await import("@/lib/providers/adapter");
    const args = { input: "hi", mode: "clarify", target: "opus_4_8" } as const;

    const events = [];
    for await (const e of enhanceStream(args)) events.push(e);

    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas.map((d) => (d.type === "delta" ? d.text : "")).join("")).toBe(
      "Enhanced\nprompt",
    );
    const done = events.at(-1);
    if (done?.type !== "done") throw new Error("expected a done event");
    expect(done.result.output).toBe("Enhanced\nprompt");
    expect(done.result.rationale).toBe("Because.");
    expect(done.result.tokenIn).toBe(21);
    expect(done.result.tokenOut).toBe(9);
    expect(done.result.costUsd).toBeGreaterThan(0);

    // The buffered form is a drain of the same stream.
    expect(await enhance(args)).toEqual(done.result);
  });
});

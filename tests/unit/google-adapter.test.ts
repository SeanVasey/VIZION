import { afterEach, describe, expect, it, vi } from "vitest";
import { streamGoogle } from "@/lib/providers/google";

/**
 * The Gemini request body.
 *
 * Gemini 3.x expresses reasoning depth as a request option, not a separate
 * model ID — the composer's thinking selector rides
 * `generationConfig.thinkingConfig` on the ONE `gemini-3.6-flash` model. Worth
 * pinning on the wire:
 *   - `thinkingLevel` is sent when the user picked one, and never the
 *     Gemini-2.5-era `thinkingBudget` (the API rejects both in one request);
 *   - no selection ("Auto") sends no thinkingConfig at all, leaving the
 *     model's own default in place;
 *   - the high level gets output headroom, because thought tokens count
 *     against maxOutputTokens and a truncated stream is a parse failure.
 */

/** A minimal SSE body: one text frame, then a usage frame. */
function sseBody(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const frames = [
    `data: ${JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"output":"hi",' }] } }],
    })}\n\n`,
    `data: ${JSON.stringify({
      candidates: [{ content: { parts: [{ text: '"rationale":"ok"}' }] } }],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        thoughtsTokenCount: 3,
      },
    })}\n\n`,
  ];
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
}

/** Drain the generator and hand back the request body the adapter sent. */
async function capture(
  opts?: Parameters<typeof streamGoogle>[3],
): Promise<{ generationConfig: Record<string, unknown> }> {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, body: sseBody() });
  vi.stubEnv("GOOGLE_API_KEY", "g-test");
  vi.stubGlobal("fetch", fetchMock);

  for await (const _chunk of streamGoogle("sys", "in", "gemini-3.6-flash", opts)) {
    void _chunk;
  }

  const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
  return JSON.parse(init.body) as { generationConfig: Record<string, unknown> };
}

describe("streamGoogle request body", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends thinkingLevel (never thinkingBudget) and output headroom at 'high'", async () => {
    const body = await capture({ thinkingLevel: "high" });
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "high" });
    expect(JSON.stringify(body)).not.toContain("thinkingBudget");
    expect(body.generationConfig.maxOutputTokens).toBe(64_000);
  });

  it("sends the minimal level without widening the output budget", async () => {
    const body = await capture({ thinkingLevel: "minimal" });
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "minimal" });
    expect(body.generationConfig.maxOutputTokens).toBe(32_000);
  });

  it("omits thinkingConfig entirely when no level is configured", async () => {
    const body = await capture();
    expect(body.generationConfig).not.toHaveProperty("thinkingConfig");
    expect(body.generationConfig.maxOutputTokens).toBe(32_000);
  });

  it("still counts thought tokens as output", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "g-test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, body: sseBody() }),
    );
    let usage: { tokenIn: number; tokenOut: number } | undefined;
    for await (const chunk of streamGoogle("sys", "in", "gemini-3.6-flash", {
      thinkingLevel: "high",
    })) {
      if (chunk.usage) usage = chunk.usage;
    }
    // 5 candidate + 3 thought tokens — dropping thoughts undercounts the cap.
    expect(usage).toEqual({ tokenIn: 10, tokenOut: 8 });
  });
});

/** Body from raw pre-encoded SSE text, so tests control the frame separators
 *  byte-for-byte. */
function rawBody(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

async function drainText(body: ReadableStream<Uint8Array>): Promise<string> {
  vi.stubEnv("GOOGLE_API_KEY", "g-test");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, body }),
  );
  let text = "";
  for await (const chunk of streamGoogle("sys", "in", "gemini-3.6-flash")) {
    if (chunk.text) text += chunk.text;
  }
  return text;
}

describe("streamGoogle frame decoding", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}`;
  const textFrame = (text: string) =>
    frame({ candidates: [{ content: { parts: [{ text }] } }] });

  it("decodes CRLF-delimited frames — the separator production Gemini sends", async () => {
    // 2026-08 production incident: every Gemini run failed with "The model
    // returned a non-JSON response." because `alt=sse` delimits events with
    // \r\n\r\n, which a bare indexOf("\n\n") never matches — zero frames
    // parsed, empty assembly, guaranteed parse failure.
    const body = rawBody(
      `${textFrame('{"output":"hi",')}\r\n\r\n${textFrame('"rationale":"ok"}')}\r\n\r\n`,
    );
    expect(await drainText(body)).toBe('{"output":"hi","rationale":"ok"}');
  });

  it("flushes a final frame that closes without its trailing blank line", async () => {
    const body = rawBody(
      `${textFrame('{"output":"hi",')}\r\n\r\n${textFrame('"rationale":"ok"}')}`,
    );
    expect(await drainText(body)).toBe('{"output":"hi","rationale":"ok"}');
  });

  it("drops thought parts so reasoning never corrupts the JSON envelope", async () => {
    const body = rawBody(
      `${frame({
        candidates: [
          {
            content: {
              parts: [
                { text: "Let me reason about this…", thought: true },
                { text: '{"output":"hi","rationale":"ok"}' },
              ],
            },
          },
        ],
      })}\n\n`,
    );
    expect(await drainText(body)).toBe('{"output":"hi","rationale":"ok"}');
  });
});

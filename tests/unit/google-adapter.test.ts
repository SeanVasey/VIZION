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
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, body: sseBody() });
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

describe("streamGoogle upstream refusals", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** Drain against a mocked non-OK response and hand back the thrown error. */
  async function failWith(status: number, statusText: string, message?: string) {
    vi.stubEnv("GOOGLE_API_KEY", "g-test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status,
        statusText,
        json: async () => (message ? { error: { message } } : {}),
      }),
    );
    try {
      for await (const _chunk of streamGoogle("sys", "in", "gemini-3.6-flash")) {
        void _chunk;
      }
    } catch (e) {
      return e as Error & { status?: number };
    }
    throw new Error("streamGoogle did not throw");
  }

  it("names the key/project remediation on a 403, keeping Google's own words", async () => {
    // The 2026-08 production refusal: Google's "denied access… contact
    // support" is about GOOGLE's project, but relayed bare it read as a
    // VIZION capability gap. The remediation (rotate GOOGLE_API_KEY) must
    // ride with it — and the upstream text must survive, uneditorialized.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const denial = "Your project has been denied access. Please contact support.";
    const e = await failWith(403, "Forbidden", denial);
    expect(e.name).toBe("ProviderError");
    expect(e.status).toBe(403);
    expect(e.message).toContain(denial);
    expect(e.message).toContain("GOOGLE_API_KEY");
    // The deployment logs said nothing while this failed in production —
    // the retained-in-prod warn is the fix for that.
    expect(warn).toHaveBeenCalledWith("[google] upstream error", 403, denial);
  });

  it("leaves non-auth failures un-editorialized", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const e = await failWith(429, "Too Many Requests", "Resource exhausted.");
    expect(e.message).toBe("Gemini request failed: Resource exhausted.");
    expect(e.message).not.toContain("GOOGLE_API_KEY");
  });
});

describe("streamGoogle honours the caller's wall", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("aborts on the ROUTE's deadline, not a fresh full-length one", async () => {
    // Codex's eighth finding (PR #91). Gemini is a hand-rolled fetch rather
    // than an SDK call, so when the route began passing an absolute deadline
    // this adapter received it and never read it — it went on arming its own
    // 285s total. A slow preflight plus a full-length Gemini stream could then
    // outrun maxDuration and skip the route's spend-settling finally.
    //
    // Proven behaviourally: a body that never completes, under a wall ~1.5s
    // out. Honouring it aborts on time; ignoring it would sit on the 60s idle
    // timer and blow this test's own timeout.
    vi.stubEnv("GOOGLE_API_KEY", "g-test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: { signal: AbortSignal }) =>
        Promise.resolve({
          ok: true,
          status: 200,
          // Opens, emits nothing, never closes — and, like a real fetch body,
          // ERRORS when the request is aborted. Wiring the signal through is
          // the whole point: a mock that ignores it cannot tell an adapter
          // that honours the wall from one that doesn't, since both would
          // simply hang.
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              init.signal.addEventListener(
                "abort",
                () => controller.error(new Error("This operation was aborted")),
                { once: true },
              );
            },
          }),
        }),
      ),
    );

    const started = Date.now();
    await expect(
      (async () => {
        for await (const chunk of streamGoogle("sys", "in", "gemini-3.6-flash", {
          deadline: Date.now() + 1_500,
        })) {
          void chunk;
        }
      })(),
    ).rejects.toMatchObject({ name: "ProviderError", status: 504 });
    expect(Date.now() - started).toBeLessThan(6_000);
  }, 15_000);

  it("never opens a connection when the budget is already spent", async () => {
    // An aborted call can still be billed once generation starts, so a wall
    // that expired during preflight must fail before fetch(), not after.
    const fetchMock = vi.fn();
    vi.stubEnv("GOOGLE_API_KEY", "g-test");
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      (async () => {
        for await (const chunk of streamGoogle("sys", "in", "gemini-3.6-flash", {
          deadline: Date.now() - 1,
        })) {
          void chunk;
        }
      })(),
    ).rejects.toMatchObject({ name: "ProviderError", status: 504 });
    expect(fetchMock).not.toHaveBeenCalled();
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
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, body }));
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

import { describe, expect, it, vi } from "vitest";

/**
 * Cost truth (INV-04, audit INV-005): when a provider stream never reports
 * usage, the adapter's ~4 chars/token fallback must be MARKED as an estimate —
 * the result view renders "≈" and the ledger row carries `estimated` — and a
 * provider-reported count must never be marked.
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

async function drainDone() {
  const { enhanceStream } = await import("@/lib/providers/adapter");
  for await (const e of enhanceStream(ARGS)) {
    if (e.type === "done") return e.result;
  }
  throw new Error("expected a done event");
}

describe("usage estimate marking (INV-04 cost truth)", () => {
  it("marks the chars/4 fallback when no usage chunk ever arrives", async () => {
    feed({ text: '{"output":"done","rationale":"why"}' });
    const result = await drainDone();
    expect(result.usageEstimated).toBe(true);
    // The fallback still charges the cap — estimates are marked, not zeroed.
    expect(result.tokenIn).toBeGreaterThan(0);
    expect(result.tokenOut).toBeGreaterThan(0);
  });

  it("adds the provider's reasoning floor to the fallback estimate (PRV-003)", async () => {
    feed(
      { text: '{"output":"done","rationale":"why"}' },
      { estReasoningTokens: 1000 },
    );
    const result = await drainDone();
    expect(result.usageEstimated).toBe(true);
    // ceil(raw/4) is ~9 tokens here — the floor must dominate.
    expect(result.tokenOut).toBeGreaterThanOrEqual(1000);
  });

  it("ignores the reasoning floor when real usage arrives", async () => {
    feed(
      { text: '{"output":"done","rationale":"why"}' },
      { estReasoningTokens: 1000 },
      { usage: { tokenIn: 12, tokenOut: 9 } },
    );
    const result = await drainDone();
    expect(result.tokenOut).toBe(9);
    expect(result.usageEstimated).toBeUndefined();
  });

  it("never marks provider-reported usage", async () => {
    feed(
      { text: '{"output":"done","rationale":"why"}' },
      { usage: { tokenIn: 12, tokenOut: 9 } },
    );
    const result = await drainDone();
    expect(result.usageEstimated).toBeUndefined();
    expect(result.tokenIn).toBe(12);
    expect(result.tokenOut).toBe(9);
  });
});

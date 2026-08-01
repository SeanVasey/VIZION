import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderStreamChunk } from "@/lib/providers/errors";

/**
 * The compat stream's reasoning accounting (PRV-003): tokens the provider
 * BILLS but never surfaces in `content` — stripped <think> spans (MiniMax)
 * and `reasoning_content` deltas (DeepSeek/DashScope/Z.ai) — must reach the
 * adapter as an estimate floor, or the no-usage fallback undercounts the
 * daily cap on exactly the runs that think hardest.
 */
const mockCreate = vi.fn();

vi.mock("openai", () => {
  class APIError extends Error {}
  function OpenAI(this: unknown) {
    return { chat: { completions: { create: mockCreate } } };
  }
  (OpenAI as unknown as { APIError: typeof APIError }).APIError = APIError;
  return { default: OpenAI };
});

function feed(chunks: Array<Record<string, unknown>>) {
  mockCreate.mockResolvedValue(
    (async function* () {
      for (const c of chunks) yield c;
    })(),
  );
}

async function drain(
  stream: AsyncGenerator<ProviderStreamChunk>,
): Promise<ProviderStreamChunk[]> {
  const out: ProviderStreamChunk[] = [];
  for await (const c of stream) out.push(c);
  return out;
}

beforeEach(() => {
  mockCreate.mockReset();
  process.env.MINIMAX_API_KEY = "k";
  process.env.DEEPSEEK_API_KEY = "k";
});

describe("openai-compat reasoning accounting (PRV-003)", () => {
  it("counts a stripped <think> span into the reasoning estimate", async () => {
    const { streamMiniMax } = await import("@/lib/providers/openai-compat");
    const think = "x".repeat(400);
    feed([
      { choices: [{ delta: { content: `<think>${think}</think>` } }] },
      { choices: [{ delta: { content: '{"output":"ok"}' } }] },
    ]);
    const chunks = await drain(streamMiniMax("sys", "in", "m"));
    const text = chunks.map((c) => c.text ?? "").join("");
    expect(text).toBe('{"output":"ok"}'); // the span never reaches the envelope
    const est = chunks.find((c) => c.estReasoningTokens !== undefined);
    // 400 chars of reasoning + the tag characters, ~4 chars/token.
    expect(est?.estReasoningTokens).toBeGreaterThanOrEqual(100);
  });

  it("counts a think span split across chunk boundaries", async () => {
    const { streamMiniMax } = await import("@/lib/providers/openai-compat");
    feed([
      { choices: [{ delta: { content: "<thi" } }] },
      { choices: [{ delta: { content: "nk>abcdefgh</thi" } }] },
      { choices: [{ delta: { content: 'nk>{"output":"ok"}' } }] },
    ]);
    const chunks = await drain(streamMiniMax("sys", "in", "m"));
    expect(chunks.map((c) => c.text ?? "").join("")).toBe('{"output":"ok"}');
    const est = chunks.find((c) => c.estReasoningTokens !== undefined);
    // 23 stripped chars (tags + 8-char span) → ceil(23/4) = 6.
    expect(est?.estReasoningTokens).toBe(6);
  });

  it("counts reasoning_content deltas without ever emitting them", async () => {
    const { streamDeepSeek } = await import("@/lib/providers/openai-compat");
    feed([
      { choices: [{ delta: { reasoning_content: "y".repeat(80) } }] },
      { choices: [{ delta: { content: '{"output":"ok"}' } }] },
    ]);
    const chunks = await drain(streamDeepSeek("sys", "in", "m"));
    expect(chunks.map((c) => c.text ?? "").join("")).toBe('{"output":"ok"}');
    const est = chunks.find((c) => c.estReasoningTokens !== undefined);
    expect(est?.estReasoningTokens).toBe(20); // ceil(80/4)
  });

  it("emits no estimate when nothing was hidden", async () => {
    const { streamDeepSeek } = await import("@/lib/providers/openai-compat");
    feed([{ choices: [{ delta: { content: '{"output":"ok"}' } }] }]);
    const chunks = await drain(streamDeepSeek("sys", "in", "m"));
    expect(chunks.some((c) => c.estReasoningTokens !== undefined)).toBe(false);
  });
});

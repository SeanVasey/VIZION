import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The OpenAI SDK refuses to construct a client in this suite's browser-like
 * environment, so the SDK is replaced by a stub whose `chat.completions.create`
 * returns a Mistral Large 4 response with `content` as typed chunks — the shape
 * under test. Everything between the SDK and the parsers is the real code.
 */
const create = vi.fn();
vi.mock("openai", () => {
  class APIError extends Error {
    status?: number;
  }
  class OpenAI {
    static APIError = APIError;
    chat = { completions: { create } };
  }
  return { default: OpenAI };
});

import { describeImage } from "@/lib/providers/vision";

afterEach(() => {
  vi.unstubAllEnvs();
  create.mockReset();
});

describe("describeImage — a chunked (typed-array) response body", () => {
  it("reads the text chunks of a Mistral reasoning response instead of parsing nothing", async () => {
    // Passed to the string parsers as-is, an array parsed as empty attributes
    // while the call still billed (Codex, PR #129).
    vi.stubEnv("MISTRAL_API_KEY", "m-test");
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: [
              { type: "thinking", thinking: [{ type: "text", text: "hmm" }] },
              { type: "text", text: '{"subject":"a red bicycle"}' },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const r = await describeImage("AAAA", "image/png", "mistral_large_4");
    expect(r.attrs).toMatchObject({ subject: "a red bicycle" });
    expect(r.tokenIn).toBe(10);
    // Large 4 gets its lowest effort word and the reasoning headroom.
    expect(create.mock.calls[0]![0]).toMatchObject({
      model: "mistral-large-4-0",
      reasoning_effort: "low",
      max_tokens: 4096,
    });
  });

  it("still passes a plain string body through unchanged", async () => {
    vi.stubEnv("MISTRAL_API_KEY", "m-test");
    create.mockResolvedValue({
      choices: [{ message: { content: '{"subject":"a lighthouse"}' } }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    });
    const r = await describeImage("AAAA", "image/png", "mistral_large_4");
    expect(r.attrs).toMatchObject({ subject: "a lighthouse" });
  });
});

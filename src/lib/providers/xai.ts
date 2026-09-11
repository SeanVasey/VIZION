import "server-only";
import OpenAI from "openai";
import { PROVIDER_MAX_RETRIES } from "@/lib/providers/config";
import {
  ProviderError,
  ProviderNotConfiguredError,
  describeProviderFailure,
  isDeepEffort,
  providerEffort,
  type ProviderRequestOptions,
  type ProviderStreamChunk,
} from "@/lib/providers/errors";
import { providerBudget, withIdleTimeout } from "@/lib/providers/idle-timeout";

/** xAI's API is OpenAI-compatible, so the adapter is the OpenAI SDK pointed
 *  at api.x.ai — no extra dependency. */
const XAI_BASE_URL = "https://api.x.ai/v1";

/** Widened like openai.ts: Grok 4.6 accepts `xhigh` on `reasoning_effort`,
 *  which this SDK version's trio type does not declare. */
type XAIStreamParams = Omit<
  OpenAI.ChatCompletionCreateParamsStreaming,
  "reasoning_effort"
> & {
  reasoning_effort?: string;
};

/** Pure request-params builder (exported for tests). Grok reasons
 *  unconditionally (xAI defaults to high effort, reasoning can't be
 *  disabled), billing its reasoning against the ceiling like the OpenAI
 *  path — so the deep tier gets the same headroom. */
export function buildXAIParams(
  model: string,
  system: string,
  input: string,
  level?: ProviderRequestOptions["thinkingLevel"],
): XAIStreamParams {
  const reasoningEffort = providerEffort("xai", level);
  return {
    model,
    max_tokens: isDeepEffort(level) ? 32_000 : 16_000,
    messages: [
      { role: "system", content: system },
      { role: "user", content: input },
    ],
    response_format: { type: "json_object" },
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    stream: true,
    stream_options: { include_usage: true },
  };
}

/**
 * Streaming xAI (Grok) call: raw response-text deltas plus a final cumulative
 * usage snapshot. Server-side only; key never reaches the client.
 *
 * `opts.thinkingLevel` maps onto Grok's `reasoning_effort` (low/medium/high/
 * xhigh on 4.6; the app's Max lands on xhigh, its top).
 */
export async function* streamXAI(
  system: string,
  input: string,
  model: string,
  opts: ProviderRequestOptions = {},
): AsyncGenerator<ProviderStreamChunk> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError("xai");

  // ONE wall for the whole call, and every timer below is cut from what it has
  // LEFT — never from the full constant. The SDK `timeout` covers the
  // connect-and-headers wait, which is time this same wall already counts.
  const { deadline, timeoutMs } = providerBudget("xai", opts.deadline);
  const client = new OpenAI({
    apiKey,
    baseURL: XAI_BASE_URL,
    timeout: timeoutMs,
    maxRetries: PROVIDER_MAX_RETRIES,
  });

  try {
    const stream = await client.chat.completions.create(
      buildXAIParams(
        model,
        system,
        input,
        opts.thinkingLevel,
      ) as OpenAI.ChatCompletionCreateParamsStreaming,
    );
    // Bounded HERE, not by the SDK: its `timeout` is cleared when fetch()
    // settles at the response headers, so it bounds nothing once the body
    // streams. Idle wall + absolute deadline both live in idle-timeout.ts.
    for await (const chunk of withIdleTimeout(stream, "xai", {
      deadline,
      cancel: () => stream.controller.abort(),
    })) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) yield { text };
      const finish = chunk.choices[0]?.finish_reason;
      if (finish) yield { stopReason: finish };
      if (chunk.usage) {
        yield {
          usage: {
            tokenIn: chunk.usage.prompt_tokens,
            tokenOut: chunk.usage.completion_tokens,
          },
        };
      }
    }
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) throw error;
    // Already shaped (e.g. the idle-timeout 504) — re-wrapping drops status.
    if (error instanceof ProviderError) throw error;
    if (error instanceof OpenAI.APIError) {
      throw new ProviderError(
        "xai",
        describeProviderFailure(
          "xai",
          "Grok",
          "XAI_API_KEY",
          error.status,
          error.message,
        ),
        error.status,
      );
    }
    throw new ProviderError(
      "xai",
      error instanceof Error ? error.message : "Unknown Grok error.",
    );
  }
}

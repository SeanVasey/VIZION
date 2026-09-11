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

/** The SDK's streaming params, widened: this SDK version types
 *  `reasoning_effort` as the low/medium/high trio, while the GPT-5.6 family
 *  and GPT-6 Astra accept `xhigh` and `max` on the same field
 *  (developers.openai.com/api/docs/guides/reasoning, 2026-09-11). Unknown
 *  values pass through to the wire as-is. */
type OpenAIStreamParams = Omit<
  OpenAI.ChatCompletionCreateParamsStreaming,
  "reasoning_effort"
> & { reasoning_effort?: string };

/** Pure request-params builder (exported for tests — no SDK mocking needed).
 *  Output ceiling: a runaway generation must stay bounded — the cost cap is
 *  only checked pre-call. Reasoning bills against this ceiling (the Anthropic
 *  path learned this first), so the deep tier gets the headroom that keeps a
 *  heavy pass from truncating the envelope. */
export function buildOpenAIParams(
  model: string,
  system: string,
  input: string,
  level?: ProviderRequestOptions["thinkingLevel"],
): OpenAIStreamParams {
  const reasoningEffort = providerEffort("openai", level);
  return {
    model,
    max_completion_tokens: isDeepEffort(level) ? 32_000 : 16_000,
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
 * Streaming OpenAI (GPT) call: yields raw response-text deltas, then one
 * cumulative usage snapshot from the final chunk (stream_options.include_usage).
 * Server-side only; key never reaches the client. The JSON envelope is decoded
 * centrally in the adapter.
 *
 * `opts.thinkingLevel` maps onto `reasoning_effort`; omitted leaves the
 * model's own default in place.
 */
export async function* streamOpenAI(
  system: string,
  input: string,
  model: string,
  opts: ProviderRequestOptions = {},
): AsyncGenerator<ProviderStreamChunk> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError("openai");

  // ONE wall for the whole call, and every timer below is cut from what it has
  // LEFT — never from the full constant. The SDK `timeout` covers the
  // connect-and-headers wait (it is cleared the moment fetch() settles), which
  // is time this same wall is already counting; handing it the constant gave
  // that wait its own full-length budget beside the stream's.
  const { deadline, timeoutMs } = providerBudget("openai", opts.deadline);
  const client = new OpenAI({
    apiKey,
    timeout: timeoutMs,
    maxRetries: PROVIDER_MAX_RETRIES,
  });

  try {
    const stream = await client.chat.completions.create(
      buildOpenAIParams(
        model,
        system,
        input,
        opts.thinkingLevel,
      ) as OpenAI.ChatCompletionCreateParamsStreaming,
    );
    // Bounded HERE, not by the SDK: its `timeout` is cleared when fetch()
    // settles at the response headers, so it bounds nothing once the body
    // streams. Idle wall + absolute deadline both live in idle-timeout.ts.
    for await (const chunk of withIdleTimeout(stream, "openai", {
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
      // Keep the upstream status so callers can classify (401/403/404 are
      // deployment-shaped, not input-shaped) — same contract as vision.
      throw new ProviderError(
        "openai",
        describeProviderFailure(
          "openai",
          "GPT",
          "OPENAI_API_KEY",
          error.status,
          error.message,
        ),
        error.status,
      );
    }
    throw new ProviderError(
      "openai",
      error instanceof Error ? error.message : "Unknown GPT error.",
    );
  }
}

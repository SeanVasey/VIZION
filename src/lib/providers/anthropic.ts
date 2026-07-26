import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import {
  ProviderError,
  ProviderNotConfiguredError,
  type ProviderRequestOptions,
  type ProviderStreamChunk,
} from "@/lib/providers/errors";

/** The SDK's stream params, widened with `output_config.effort` — the GA
 *  reasoning-depth control on the Claude 5 family. This SDK version's types
 *  don't declare it yet; unknown body keys pass through to the wire as-is. */
type AnthropicStreamParams = Parameters<Anthropic["messages"]["stream"]>[0] & {
  output_config?: { effort: string };
};

/**
 * Streaming Anthropic call: yields raw response-text deltas plus cumulative
 * usage snapshots (input tokens from message_start, output tokens updated by
 * each message_delta). The adapter decodes the JSON envelope centrally.
 *
 * `opts.thinkingLevel` maps onto `output_config.effort` (low…max). The Claude
 * 5 family thinks by default and bills thinking as output tokens against
 * `max_tokens`, so the higher efforts get output headroom — a deep reasoning
 * pass inside a tight cap would truncate the JSON envelope mid-stream.
 */
export async function* streamAnthropic(
  system: string,
  input: string,
  model: string,
  opts: ProviderRequestOptions = {},
): AsyncGenerator<ProviderStreamChunk> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError("anthropic");

  const client = new Anthropic({ apiKey });
  let tokenIn = 0;
  const effort = opts.thinkingLevel;

  try {
    const params: AnthropicStreamParams = {
      model,
      max_tokens:
        effort === "xhigh" || effort === "max"
          ? 64_000
          : effort === "high"
            ? 32_000
            : 16_000,
      system,
      messages: [{ role: "user", content: input }],
      ...(effort ? { output_config: { effort } } : {}),
    };
    const stream = client.messages.stream(params);
    for await (const event of stream) {
      if (event.type === "message_start") {
        tokenIn = event.message.usage.input_tokens;
        yield { usage: { tokenIn, tokenOut: event.message.usage.output_tokens } };
      } else if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield { text: event.delta.text };
      } else if (event.type === "message_delta") {
        yield { usage: { tokenIn, tokenOut: event.usage.output_tokens } };
      }
    }
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) throw error;
    if (error instanceof Anthropic.APIError) {
      throw new ProviderError(
        "anthropic",
        `Opus request failed: ${error.message}`,
        error.status,
      );
    }
    throw new ProviderError(
      "anthropic",
      error instanceof Error ? error.message : "Unknown Opus error.",
    );
  }
}

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { PROVIDER_MAX_RETRIES, PROVIDER_TOTAL_MS } from "@/lib/providers/config";
import {
  ProviderError,
  ProviderNotConfiguredError,
  type ProviderRequestOptions,
  type ProviderStreamChunk,
} from "@/lib/providers/errors";
import { providerDeadline, withIdleTimeout } from "@/lib/providers/idle-timeout";

/** The SDK's stream params, widened with `output_config.effort` — the GA
 *  reasoning-depth control on the Claude 5 family. This SDK version's types
 *  don't declare it yet; unknown body keys pass through to the wire as-is. */
type AnthropicStreamParams = Parameters<Anthropic["messages"]["stream"]>[0] & {
  output_config?: { effort: string };
};

/**
 * Pure request-params builder (exported for tests — no SDK mocking needed).
 *
 * max_tokens is a ceiling, not a target: the Claude 5 family thinks by
 * default and bills thinking as output against it, so the UNSET-effort path
 * needs the same headroom as an explicit mid effort — a distinct 16k default
 * tier once made Auto the tightest path in the fleet, truncating envelopes
 * exactly when no thinking level was chosen. The daily cost cap and the
 * route's maxDuration still bound the true worst case.
 */
export function buildAnthropicParams(
  model: string,
  system: string,
  input: string,
  effort?: string,
): AnthropicStreamParams {
  return {
    model,
    max_tokens: effort === "xhigh" || effort === "max" ? 64_000 : 32_000,
    system,
    messages: [{ role: "user", content: input }],
    ...(effort ? { output_config: { effort } } : {}),
  };
}

/**
 * Streaming Anthropic call: yields raw response-text deltas plus cumulative
 * usage snapshots (input tokens from message_start, output tokens updated by
 * each message_delta). The adapter decodes the JSON envelope centrally.
 *
 * `opts.thinkingLevel` maps onto `output_config.effort` (low…max); the token
 * ceiling per effort lives in buildAnthropicParams.
 */
export async function* streamAnthropic(
  system: string,
  input: string,
  model: string,
  opts: ProviderRequestOptions = {},
): AsyncGenerator<ProviderStreamChunk> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError("anthropic");

  // ONE wall for the whole call. The ROUTE takes it at entry so its preflight
  // (auth, settings, reserveSpend) counts too; a fresh one here is the
  // fallback for direct adapter use and tests.
  const deadline = opts.deadline ?? providerDeadline();
  const client = new Anthropic({
    apiKey,
    timeout: PROVIDER_TOTAL_MS,
    maxRetries: PROVIDER_MAX_RETRIES,
  });
  let tokenIn = 0;
  const effort = opts.thinkingLevel;

  try {
    const stream = client.messages.stream(buildAnthropicParams(model, system, input, effort));
    // Bounded HERE, not by the SDK: its `timeout` is cleared when fetch()
    // settles at the response headers, so it bounds nothing once the body
    // streams. Idle wall + absolute deadline both live in idle-timeout.ts.
    for await (const event of withIdleTimeout(stream, "anthropic", {
      deadline,
      // MessageStream.abort() -> controller.abort(); without it the queued
      // iterator.return() cannot run while a read is pending.
      cancel: () => stream.abort(),
    })) {
      if (event.type === "message_start") {
        tokenIn = event.message.usage.input_tokens;
        // `input_tokens` here is real; `output_tokens` is a 1-4 placeholder
        // sent before generation starts. Flagged so consumers can floor it
        // with a live estimate instead of displaying it as measured.
        yield {
          usage: { tokenIn, tokenOut: event.message.usage.output_tokens },
          usageSnapshot: true,
        };
      } else if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield { text: event.delta.text };
      } else if (event.type === "message_delta") {
        yield {
          usage: { tokenIn, tokenOut: event.usage.output_tokens },
          ...(event.delta.stop_reason ? { stopReason: event.delta.stop_reason } : {}),
        };
      }
    }
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) throw error;
    // Already shaped (e.g. the idle-timeout 504) — re-wrapping would drop its
    // status and bury the reason inside a generic message.
    if (error instanceof ProviderError) throw error;
    if (error instanceof Anthropic.APIError) {
      // "Anthropic", not "Opus": this one stream serves Opus 5, Sonnet 5,
      // and Fable 5 — naming one model mislabels the other two's failures.
      throw new ProviderError(
        "anthropic",
        `Anthropic request failed: ${error.message}`,
        error.status,
      );
    }
    throw new ProviderError(
      "anthropic",
      error instanceof Error ? error.message : "Unknown Anthropic error.",
    );
  }
}

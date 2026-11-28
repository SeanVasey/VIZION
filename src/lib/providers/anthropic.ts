import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { PROVIDER_MAX_RETRIES } from "@/lib/providers/config";
import {
  ProviderError,
  ProviderNotConfiguredError,
  describeProviderFailure,
  providerEffort,
  type EffortVocabulary,
  type ProviderRequestOptions,
  type ProviderStreamChunk,
} from "@/lib/providers/errors";
import { providerBudget, withIdleTimeout } from "@/lib/providers/idle-timeout";

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
 * default (and from the 5.5 generation thinking cannot be disabled at all)
 * and bills thinking as output against it, so the UNSET-effort path
 * needs the same headroom as an explicit mid effort — a distinct 16k default
 * tier once made Auto the tightest path in the fleet, truncating envelopes
 * exactly when no thinking level was chosen. The daily cost cap and the
 * route's maxDuration still bound the true worst case.
 *
 * `effort` arrives in the APP's ladder vocabulary and is translated here
 * (`providerEffort("five", …)`): Anthropic serves all five words, so the
 * only fold is the legacy `minimal` → `low`.
 */
export function buildAnthropicParams(
  model: string,
  system: string,
  input: string,
  effort?: string,
  vocabulary: EffortVocabulary = "five",
): AnthropicStreamParams {
  // Every Claude model on the roster serves all five words (Haiku 5.5
  // included), so the per-target vocabulary is "five" throughout; it is a
  // parameter only so this adapter cannot disagree with config.ts.
  const wire = providerEffort(
    vocabulary,
    effort as ProviderRequestOptions["thinkingLevel"],
  );
  return {
    model,
    max_tokens: wire === "xhigh" || wire === "max" ? 64_000 : 32_000,
    system,
    messages: [{ role: "user", content: input }],
    ...(wire ? { output_config: { effort: wire } } : {}),
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

  // ONE wall for the whole call, and every timer below is cut from what it has
  // LEFT — never from the full constant. The SDK `timeout` covers the
  // connect-and-headers wait, which is time this same wall already counts.
  const { deadline, timeoutMs } = providerBudget("anthropic", opts.deadline);
  const client = new Anthropic({
    apiKey,
    timeout: timeoutMs,
    maxRetries: PROVIDER_MAX_RETRIES,
  });
  let tokenIn = 0;
  const effort = opts.thinkingLevel;

  try {
    const stream = client.messages.stream(
      buildAnthropicParams(model, system, input, effort, opts.effortVocabulary),
    );
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
        // `stop_details` rides beside `stop_reason` on a refusal (category +
        // explanation). This SDK version's delta type predates it, so it is
        // read through a widened view and trusted only as a display string.
        const category = (event.delta as { stop_details?: { category?: unknown } | null })
          .stop_details?.category;
        yield {
          usage: { tokenIn, tokenOut: event.usage.output_tokens },
          ...(event.delta.stop_reason ? { stopReason: event.delta.stop_reason } : {}),
          ...(typeof category === "string" ? { refusalCategory: category } : {}),
        };
      }
    }
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) throw error;
    // Already shaped (e.g. the idle-timeout 504) — re-wrapping would drop its
    // status and bury the reason inside a generic message.
    if (error instanceof ProviderError) throw error;
    if (error instanceof Anthropic.APIError) {
      // "Anthropic", not "Opus": this one stream serves Fable, Opus, Sonnet
      // and Haiku — naming one model mislabels the others' failures.
      throw new ProviderError(
        "anthropic",
        describeProviderFailure(
          "anthropic",
          "Anthropic",
          "ANTHROPIC_API_KEY",
          error.status,
          error.message,
        ),
        error.status,
      );
    }
    throw new ProviderError(
      "anthropic",
      error instanceof Error ? error.message : "Unknown Anthropic error.",
    );
  }
}

import "server-only";
import OpenAI from "openai";
import { PROVIDER_MAX_RETRIES } from "@/lib/providers/config";
import {
  ProviderError,
  ProviderNotConfiguredError,
  describeProviderFailure,
  isDeepEffort,
  providerEffort,
  type EffortVocabulary,
  type ProviderRequestOptions,
  type ProviderStreamChunk,
} from "@/lib/providers/errors";
import { providerBudget, withIdleTimeout } from "@/lib/providers/idle-timeout";

/** Mistral's chat API is OpenAI-compatible (incl. json_object + streaming),
 *  so the adapter is the OpenAI SDK pointed at api.mistral.ai — no extra
 *  dependency (same pattern as xai.ts). */
const MISTRAL_BASE_URL = "https://api.mistral.ai/v1";

/** The SDK's streaming params, widened like openai.ts and xai.ts for the
 *  effort word. */
type MistralStreamParams = Omit<
  OpenAI.ChatCompletionCreateParamsStreaming,
  "reasoning_effort"
> & { reasoning_effort?: string };

/**
 * Pure request-params builder (exported for tests — no SDK mocking needed).
 *
 * Mistral Large 4 is a REASONING model, which changed two things this
 * adapter had hard-coded for Large 3. It takes a top-level
 * `reasoning_effort` (low · medium · high, default high — and it does not
 * accept none/minimal/xhigh/max, so the app's Max lands on `high`, its top;
 * docs.mistral.ai/inference/conversations/reasoning, 2026-11-28). And its
 * reasoning is billed against `max_tokens`, so the flat 16k ceiling that
 * suited a model that never reasoned now needs the same deep-tier step the
 * other reasoning adapters take.
 *
 * Still NO `stream_options`: Mistral rejects unknown request fields (422),
 * and its final stream chunk carries usage by default. `reasoning_effort` is
 * a documented field, not an unknown one — and it is omitted entirely when
 * no level was resolved, so a non-reasoning model pointed at via
 * MODEL_MISTRAL is never sent it.
 */
export function buildMistralParams(
  model: string,
  system: string,
  input: string,
  level?: ProviderRequestOptions["thinkingLevel"],
  vocabulary: EffortVocabulary = "toHigh",
): MistralStreamParams {
  const reasoningEffort = providerEffort(vocabulary, level);
  return {
    model,
    // Output ceiling: a runaway generation must stay bounded. Classic
    // max_tokens — Mistral 422s on unknown fields like max_completion_tokens.
    max_tokens: isDeepEffort(level) ? 32_000 : 16_000,
    messages: [
      { role: "system", content: system },
      { role: "user", content: input },
    ],
    response_format: { type: "json_object" },
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    stream: true,
  };
}

/**
 * A Mistral delta's answer text. Mistral's reasoning models may stream
 * `content` as an ARRAY of typed chunks (`thinking` beside `text`) rather
 * than the plain string the OpenAI SDK types — and a thinking chunk
 * concatenated into the stream would corrupt the JSON envelope exactly as
 * Gemini's `thought` parts would. Text chunks only; a string passes through.
 * Defensive by construction: written from the documented shape, not from a
 * captured Large 4 stream (no key in the gate) — see the providers runbook.
 */
export function mistralText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: unknown) =>
      typeof part === "object" &&
      part !== null &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .join("");
}

/**
 * Streaming Mistral call: raw response-text deltas plus a cumulative usage
 * snapshot from the final chunk. Server-side only; key never reaches the
 * client. `opts.thinkingLevel` maps onto `reasoning_effort` (see the builder).
 */
export async function* streamMistral(
  system: string,
  input: string,
  model: string,
  opts: ProviderRequestOptions = {},
): AsyncGenerator<ProviderStreamChunk> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError("mistral");

  // ONE wall for the whole call, and every timer below is cut from what it has
  // LEFT — never from the full constant. The SDK `timeout` covers the
  // connect-and-headers wait, which is time this same wall already counts.
  const { deadline, timeoutMs } = providerBudget("mistral", opts.deadline);
  const client = new OpenAI({
    apiKey,
    baseURL: MISTRAL_BASE_URL,
    timeout: timeoutMs,
    maxRetries: PROVIDER_MAX_RETRIES,
  });

  try {
    const stream = await client.chat.completions.create(
      buildMistralParams(
        model,
        system,
        input,
        opts.thinkingLevel,
        opts.effortVocabulary,
      ) as OpenAI.ChatCompletionCreateParamsStreaming,
    );
    // Bounded HERE, not by the SDK: its `timeout` is cleared when fetch()
    // settles at the response headers, so it bounds nothing once the body
    // streams. Idle wall + absolute deadline both live in idle-timeout.ts.
    for await (const chunk of withIdleTimeout(stream, "mistral", {
      deadline,
      cancel: () => stream.controller.abort(),
    })) {
      const text = mistralText(chunk.choices[0]?.delta?.content);
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
      // A 401 here is the 2026-09 screenshot ("401 status code (no body)"):
      // Mistral answers a refused key with an EMPTY body, so without the
      // helper's sentence the user gets a bare status and no next step.
      throw new ProviderError(
        "mistral",
        describeProviderFailure(
          "mistral",
          "Mistral",
          "MISTRAL_API_KEY",
          error.status,
          error.message,
        ),
        error.status,
      );
    }
    throw new ProviderError(
      "mistral",
      error instanceof Error ? error.message : "Unknown Mistral error.",
    );
  }
}

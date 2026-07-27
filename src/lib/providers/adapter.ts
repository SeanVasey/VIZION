import "server-only";
import type { ModeId, TargetModelId, ThinkingLevel } from "@/lib/constants";
import { TARGETS, computeCost, type Provider } from "@/lib/providers/config";
import type {
  ProviderRequestOptions,
  ProviderStreamChunk,
} from "@/lib/providers/errors";
import {
  buildSystemPrompt,
  parseEnhancePayload,
  type EnhanceRefine,
} from "@/lib/providers/formatters";
import type { FormatId } from "@/lib/enhance/formats";
import type { LengthId } from "@/lib/enhance/lengths";
import { createEnvelopeScanner } from "@/lib/providers/json-stream";
import { streamAnthropic } from "@/lib/providers/anthropic";
import { streamOpenAI } from "@/lib/providers/openai";
import { streamGoogle } from "@/lib/providers/google";
import { streamMistral } from "@/lib/providers/mistral";
import { streamXAI } from "@/lib/providers/xai";
import {
  streamDeepSeek,
  streamMeta,
  streamMiniMax,
  streamMoonshot,
  streamPerplexity,
  streamQwen,
  streamZai,
} from "@/lib/providers/openai-compat";

export interface EnhanceArgs {
  input: string;
  mode: ModeId;
  target: TargetModelId;
  /** User-selected reasoning depth (validated by the route against
   *  TARGET_THINKING_LEVELS). Absent = the provider's own default. */
  thinkingLevel?: ThinkingLevel;
  /** Refinement pass over an already-enhanced prompt (validated by the route). */
  refine?: EnhanceRefine;
  /** Reformat's explicit output shape (validated by the route). Inert in any
   *  other mode — buildSystemPrompt gates it. */
  format?: FormatId;
  /** Condense/Expand depth (validated by the route). Inert elsewhere. */
  length?: LengthId;
}

export interface EnhanceOutput {
  output: string;
  rationale: string;
  /** Optional envelope extensions (parsed tolerantly — see EnhancePayload). */
  assumptions?: string[];
  targetNotes?: string;
  title?: string;
  tokenIn: number;
  tokenOut: number;
  modelUsed: string;
  costUsd: number;
  /** The envelope's tail was malformed but the output string demonstrably
   *  completed — the result was recovered from the stream (rationale is
   *  empty). Rides to the client so the result view can say so. */
  salvaged?: boolean;
}

/** Events surfaced by the streaming adapter. `delta` text is the DECODED
 *  output field (the envelope scanner runs here, once, for every provider);
 *  `usage` snapshots are cumulative. `done` always closes a successful run. */
export type AdapterStreamEvent =
  | { type: "delta"; text: string }
  | { type: "usage"; tokenIn: number; tokenOut: number }
  | { type: "done"; result: EnhanceOutput };

/** The shape every provider adapter satisfies. `opts` is optional, so the
 *  adapters that take no request tuning stay three-parameter functions — TS
 *  accepts a narrower function where a wider signature is expected. */
type ProviderStream = (
  system: string,
  input: string,
  model: string,
  opts?: ProviderRequestOptions,
) => AsyncGenerator<ProviderStreamChunk>;

/**
 * The provider adapter (FINAL_PLAN D9), streaming form. A single
 * `enhanceStream(input, mode, target)` fans out to the model-specific raw
 * token stream, incrementally decodes the JSON envelope's output field, and
 * finishes by validating the full text with the same parseEnhancePayload
 * contract as ever. Model strings live in config, so swapping a model is a
 * config change, not a refactor.
 */
export async function* enhanceStream({
  input,
  mode,
  target,
  thinkingLevel,
  refine,
  format,
  length,
}: EnhanceArgs): AsyncGenerator<AdapterStreamEvent> {
  const cfg = TARGETS[target];
  const system = buildSystemPrompt({ mode, target, refine, format, length });

  const streams: Record<Provider, ProviderStream> = {
    anthropic: streamAnthropic,
    openai: streamOpenAI,
    deepseek: streamDeepSeek,
    google: streamGoogle,
    meta: streamMeta,
    minimax: streamMiniMax,
    mistral: streamMistral,
    moonshot: streamMoonshot,
    perplexity: streamPerplexity,
    qwen: streamQwen,
    xai: streamXAI,
    zai: streamZai,
  };

  const scanner = createEnvelopeScanner("output");
  let raw = "";
  let decoded = "";
  let stopReason: string | undefined;
  let tokenIn = 0;
  let tokenOut = 0;

  for await (const chunk of streams[cfg.provider](system, input, cfg.model, {
    thinkingLevel,
  })) {
    if (chunk.text) {
      raw += chunk.text;
      const piece = scanner.push(chunk.text);
      if (piece) {
        decoded += piece;
        yield { type: "delta", text: piece };
      }
    }
    if (chunk.usage) {
      ({ tokenIn, tokenOut } = chunk.usage);
      yield { type: "usage", tokenIn, tokenOut };
    }
    if (chunk.stopReason) stopReason = chunk.stopReason;
  }

  // A provider that never reported usage (defensive) still must count against
  // the cost cap — fall back to the ~4 chars/token estimate.
  if (tokenIn === 0) tokenIn = Math.ceil((system.length + input.length) / 4);
  if (tokenOut === 0 && raw.length > 0) tokenOut = Math.ceil(raw.length / 4);

  let payload;
  let salvaged = false;
  try {
    payload = parseEnhancePayload(raw);
  } catch (e) {
    if (scanner.done && decoded.trim() !== "") {
      // The output string demonstrably completed (its closing quote was
      // seen) — a malformed tail must not discard a paid, fully-streamed
      // result. Recover it; the rationale is honestly empty.
      payload = { output: decoded.trim(), rationale: "" };
      salvaged = true;
    } else if (stopReason !== undefined && LENGTH_STOPS.has(stopReason)) {
      throw new Error(
        "The model hit its length limit before finishing. Try a lower thinking level or a shorter prompt.",
      );
    } else {
      throw e;
    }
  }
  yield {
    type: "done",
    result: {
      ...payload,
      tokenIn,
      tokenOut,
      modelUsed: cfg.model,
      costUsd: computeCost(target, tokenIn, tokenOut),
      ...(salvaged ? { salvaged: true } : {}),
    },
  };
}

/** Stop/finish wire values that mean "the model ran out of output budget"
 *  (Anthropic: max_tokens · OpenAI-compat: length · Gemini: MAX_TOKENS ·
 *  Mistral: model_length). */
const LENGTH_STOPS = new Set(["length", "max_tokens", "MAX_TOKENS", "model_length"]);

/** Buffered form — a drain of the stream, so there is exactly one code path. */
export async function enhance(args: EnhanceArgs): Promise<EnhanceOutput> {
  for await (const event of enhanceStream(args)) {
    if (event.type === "done") return event.result;
  }
  // Unreachable: enhanceStream either yields `done` or throws.
  throw new Error("The model stream ended without a result.");
}

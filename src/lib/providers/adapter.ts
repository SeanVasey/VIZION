import "server-only";
import type { ModeId, TargetModelId } from "@/lib/constants";
import { TARGETS, computeCost } from "@/lib/providers/config";
import { buildSystemPrompt, parseEnhancePayload } from "@/lib/providers/formatters";
import { createEnvelopeScanner } from "@/lib/providers/json-stream";
import { streamAnthropic } from "@/lib/providers/anthropic";
import { streamOpenAI } from "@/lib/providers/openai";
import { streamGoogle } from "@/lib/providers/google";
import { streamMistral } from "@/lib/providers/mistral";
import { streamXAI } from "@/lib/providers/xai";

export interface EnhanceArgs {
  input: string;
  mode: ModeId;
  target: TargetModelId;
}

export interface EnhanceOutput {
  output: string;
  rationale: string;
  tokenIn: number;
  tokenOut: number;
  modelUsed: string;
  costUsd: number;
}

/** Events surfaced by the streaming adapter. `delta` text is the DECODED
 *  output field (the envelope scanner runs here, once, for every provider);
 *  `usage` snapshots are cumulative. `done` always closes a successful run. */
export type AdapterStreamEvent =
  | { type: "delta"; text: string }
  | { type: "usage"; tokenIn: number; tokenOut: number }
  | { type: "done"; result: EnhanceOutput };

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
}: EnhanceArgs): AsyncGenerator<AdapterStreamEvent> {
  const cfg = TARGETS[target];
  const system = buildSystemPrompt(mode, target);

  const streams = {
    anthropic: streamAnthropic,
    openai: streamOpenAI,
    google: streamGoogle,
    mistral: streamMistral,
    xai: streamXAI,
  } as const;

  const scanner = createEnvelopeScanner("output");
  let raw = "";
  let tokenIn = 0;
  let tokenOut = 0;

  for await (const chunk of streams[cfg.provider](system, input, cfg.model)) {
    if (chunk.text) {
      raw += chunk.text;
      const decoded = scanner.push(chunk.text);
      if (decoded) yield { type: "delta", text: decoded };
    }
    if (chunk.usage) {
      ({ tokenIn, tokenOut } = chunk.usage);
      yield { type: "usage", tokenIn, tokenOut };
    }
  }

  // A provider that never reported usage (defensive) still must count against
  // the cost cap — fall back to the ~4 chars/token estimate.
  if (tokenIn === 0) tokenIn = Math.ceil((system.length + input.length) / 4);
  if (tokenOut === 0 && raw.length > 0) tokenOut = Math.ceil(raw.length / 4);

  const payload = parseEnhancePayload(raw);
  yield {
    type: "done",
    result: {
      ...payload,
      tokenIn,
      tokenOut,
      modelUsed: cfg.model,
      costUsd: computeCost(target, tokenIn, tokenOut),
    },
  };
}

/** Buffered form — a drain of the stream, so there is exactly one code path. */
export async function enhance(args: EnhanceArgs): Promise<EnhanceOutput> {
  for await (const event of enhanceStream(args)) {
    if (event.type === "done") return event.result;
  }
  // Unreachable: enhanceStream either yields `done` or throws.
  throw new Error("The model stream ended without a result.");
}

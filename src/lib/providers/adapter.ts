import "server-only";
import type { ModeId, TargetModelId } from "@/lib/constants";
import { TARGETS, computeCost } from "@/lib/providers/config";
import { buildSystemPrompt } from "@/lib/providers/formatters";
import { callAnthropic } from "@/lib/providers/anthropic";
import { callOpenAI } from "@/lib/providers/openai";
import { callGoogle } from "@/lib/providers/google";

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

/**
 * The provider adapter (FINAL_PLAN D9). A single `enhance(input, mode, target)`
 * fans out to the model-specific implementation. Model strings live in config,
 * so swapping a model is a config change, not a refactor.
 */
export async function enhance({
  input,
  mode,
  target,
}: EnhanceArgs): Promise<EnhanceOutput> {
  const cfg = TARGETS[target];
  const system = buildSystemPrompt(mode, target);

  const result =
    cfg.provider === "anthropic"
      ? await callAnthropic(system, input, cfg.model)
      : cfg.provider === "openai"
        ? await callOpenAI(system, input, cfg.model)
        : await callGoogle(system, input, cfg.model);

  return {
    ...result,
    modelUsed: cfg.model,
    costUsd: computeCost(target, result.tokenIn, result.tokenOut),
  };
}

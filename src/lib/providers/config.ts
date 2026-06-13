import type { TargetModelId } from "@/lib/constants";

export type Provider = "anthropic" | "openai" | "google";

interface TargetConfig {
  provider: Provider;
  /** Model string actually sent to the provider — overridable via env (D9). */
  model: string;
  /** USD per 1M input / output tokens, for the cost cap. */
  priceIn: number;
  priceOut: number;
}

/**
 * Target → provider + model-string mapping. Model strings live here (env-
 * overridable) so swapping a model is config, not a refactor (FINAL_PLAN D9).
 * Defaults: Opus uses the authoritative `claude-opus-4-8`; GPT/Gemini default to
 * the named product targets and can be pointed at any deployed string via env.
 */
export const TARGETS: Record<TargetModelId, TargetConfig> = {
  opus_4_8: {
    provider: "anthropic",
    model: process.env.MODEL_OPUS ?? "claude-opus-4-8",
    priceIn: numEnv("PRICE_OPUS_IN", 5),
    priceOut: numEnv("PRICE_OPUS_OUT", 25),
  },
  gpt_5_5: {
    provider: "openai",
    model: process.env.MODEL_GPT ?? "gpt-5.5",
    priceIn: numEnv("PRICE_GPT_IN", 5),
    priceOut: numEnv("PRICE_GPT_OUT", 15),
  },
  gemini_pro_3_1: {
    provider: "google",
    model: process.env.MODEL_GEMINI ?? "gemini-pro-3.1",
    priceIn: numEnv("PRICE_GEMINI_IN", 2),
    priceOut: numEnv("PRICE_GEMINI_OUT", 10),
  },
};

function numEnv(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** Cost in USD for a call, from token counts and the target's pricing. */
export function computeCost(
  target: TargetModelId,
  tokenIn: number,
  tokenOut: number,
): number {
  const { priceIn, priceOut } = TARGETS[target];
  const cost = (tokenIn / 1_000_000) * priceIn + (tokenOut / 1_000_000) * priceOut;
  // Round to 6 dp to match the numeric(10,6) column.
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** Per-user limits (env-overridable). Enforced on every model route. */
export const RATE_LIMIT_PER_MIN = numEnv("RATE_LIMIT_PER_MIN", 20);
export const COST_CAP_USD_PER_DAY = numEnv("COST_CAP_USD_PER_DAY", 2);

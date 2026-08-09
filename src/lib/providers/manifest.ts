import "server-only";
import type { TargetModelId } from "@/lib/constants";
import { TARGETS } from "@/lib/providers/config";

/**
 * Per-target ROUTING facts — the data Auto ranks the roster with.
 *
 * A deliberate partial delivery of PROD-05 (capability manifest): this file
 * consolidates only what routing needs — strength, speed, pool membership —
 * beside the pricing that already lives in `config.ts`. Vision capability
 * stays in `vision.ts`, thinking ladders in `constants.ts`, JSON-mode and
 * output ceilings in `openai-compat.ts`; folding those sources into one
 * record is the follow-up on the audit ledger (PROD-05), not this file's job.
 *
 * `strength` is an EDITORIAL rank — an opinion held in one reviewable place,
 * not a benchmark claim. Each entry carries a one-line rationale sourced from
 * the vendor's own positioning (checked 2026-08-08); re-rank here, never
 * inline in the router.
 */

/** Latency posture at default settings — light-tier jobs reward `fast`. */
export type SpeedClass = "fast" | "standard" | "deliberate";

interface RoutingFacts {
  /** Editorial capability rank, 1–10 (10 = the strongest thing we route). */
  strength: number;
  speed: SpeedClass;
  /** Kept out of Auto's pool (still fully pickable manually) — say why. */
  autoExcluded?: true;
}

/** Typed as a full Record: a seventeenth roster entry is a compile error
 *  here, not a silent hole in Auto's ladders. */
export const TARGET_ROUTING: Record<TargetModelId, RoutingFacts> = {
  // Anthropic's most capable model — the reasoning ceiling of the roster.
  fable_5: { strength: 10, speed: "deliberate" },
  // Flagship Opus: frontier quality at half Fable's price.
  opus_5: { strength: 9, speed: "deliberate" },
  // Near-Opus judgement with the best latency of the Anthropic trio.
  sonnet_5: { strength: 8, speed: "fast" },
  // OpenAI's flagship tier of the GPT-5.6 family.
  gpt_5_6_sol: { strength: 9, speed: "deliberate" },
  // The small, cost-efficient GPT-5.6 tier (the family's throughput model).
  gpt_5_6_luna: { strength: 5, speed: "fast" },
  // The balanced mid tier of the GPT-5.6 family.
  gpt_5_6_terra: { strength: 7, speed: "standard" },
  // Open-weight flagship MoE; strong text reasoning at commodity pricing.
  deepseek_v4: { strength: 7, speed: "standard" },
  // Google's fast tier — capable all-rounder tuned for latency.
  gemini_3_6_flash: { strength: 7, speed: "fast" },
  // Meta's general model; solid but below the frontier tier on hard tasks.
  muse_spark_1_1: { strength: 5, speed: "standard" },
  // Agentic MoE with adaptive thinking; executes well-scoped plans.
  minimax_m3: { strength: 5, speed: "fast" },
  // Mistral's open-weight flagship; dependable, no reasoning control.
  mistral_large_3: { strength: 7, speed: "standard" },
  // Large open-weight reasoning MoE; strong, less proven than the tier above.
  kimi_k3: { strength: 6, speed: "standard" },
  // Search-grounded specialist: answers cite the live web, which changes the
  // output's character for a prompt-rewriting task, and it bills a
  // per-request search fee the per-token cost model can't see. Manual pick
  // only — Auto never lands a user on it by surprise.
  sonar_pro: { strength: 6, speed: "standard", autoExcluded: true },
  // Alibaba's flagship tier; broad capability, thinking-budget control.
  qwen3_8_max: { strength: 7, speed: "standard" },
  // xAI's flagship: near-frontier reasoning at a mid-tier price.
  grok_4_5: { strength: 8, speed: "standard" },
  // Zhipu's open-weight flagship; capable, priced below its strength peers.
  glm_5_2: { strength: 6, speed: "standard" },
};

/**
 * Blended $/1M at a documented 1:1 in:out token mix. Output prices run 3–5×
 * input across the roster, so the ranking is insensitive to the exact ratio —
 * the constant is an editorial simplification, stated rather than hidden.
 *
 * Reads the LIVE `TARGETS` prices, so a `PRICE_*` env override re-ranks Auto
 * as well as re-pricing the cost cap — a price change is a routing change now
 * (docs/runbooks/providers.md). The alternative (static defaults here) would
 * let Auto rank by prices the cap no longer charges.
 */
export function blendedPrice(target: TargetModelId): number {
  const { priceIn, priceOut } = TARGETS[target];
  return (priceIn + priceOut) / 2;
}

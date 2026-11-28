import "server-only";
import type { TargetModelId } from "@/lib/constants";
import { TARGETS } from "@/lib/providers/config";

/**
 * Per-target ROUTING facts — the data Auto ranks the roster with.
 *
 * A deliberate partial delivery of PROD-05 (capability manifest): this file
 * consolidates only what routing needs — strength, speed, pool membership —
 * beside the pricing that already lives in `config.ts`. The per-target effort
 * vocabulary joined `config.ts` in 2026-11 (it had to: two Gemini 4 models
 * accept different words). Vision capability stays in `vision.ts`, JSON-mode
 * and output ceilings in `openai-compat.ts`; folding those into one record
 * is still the follow-up on the audit ledger (PROD-05), not this file's job.
 *
 * `strength` is an EDITORIAL rank — an opinion held in one reviewable place,
 * not a benchmark claim. Each entry carries a one-line rationale sourced from
 * the vendor's own positioning (checked 2026-11-28); re-rank here, never
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

/** Typed as a full Record: a new roster entry is a compile error here, not a
 *  silent hole in Auto's ladders. */
export const TARGET_ROUTING: Record<TargetModelId, RoutingFacts> = {
  // Anthropic's most capable model — the reasoning ceiling of the roster.
  fable_5_2: { strength: 10, speed: "deliberate" },
  // Flagship Opus: frontier quality at half Fable's price.
  opus_5_5: { strength: 9, speed: "deliberate" },
  // Near-Opus judgement with the best latency of the larger Claude tiers.
  sonnet_5_5: { strength: 8, speed: "fast" },
  // Anthropic's small tier: quick and very cheap, for bounded jobs.
  haiku_5_5: { strength: 6, speed: "fast" },
  // OpenAI's frontier tier — "for your hardest projects"; Fable-class price.
  gpt_6_2_astra: { strength: 10, speed: "deliberate" },
  // OpenAI's everyday flagship: OpenAI puts it within half a point of Astra
  // on its coding eval at a quarter of the token price.
  gpt_6_2_sol: { strength: 9, speed: "standard" },
  // The small, cost-efficient GPT tier (the family's throughput model).
  gpt_6_luna: { strength: 5, speed: "fast" },
  // The balanced mid tier, positioned by OpenAI as fast and high-volume.
  gpt_6_1_terra: { strength: 7, speed: "fast" },
  // Open-weight flagship MoE; strong text reasoning at time-of-day pricing.
  deepseek_v4: { strength: 7, speed: "standard" },
  // Google's strongest reasoning model — "the hardest architecture,
  // debugging" and long-horizon work.
  gemini_4_carbon: { strength: 9, speed: "deliberate" },
  // Sits between Hydrogen and Carbon; Google's pick for complex engineering.
  gemini_4_neon: { strength: 8, speed: "standard" },
  // Google's fast general-purpose default — capable all-rounder tuned for
  // latency (the old Flash slot).
  gemini_4_hydrogen: { strength: 7, speed: "fast" },
  // "Meta's most capable model", but a preview with regional gaps and a
  // vendor-default effort of max — strong, unproven, and never fast.
  muse_wonder_1_0: { strength: 8, speed: "deliberate" },
  // Meta's recommended general model; solid, below the frontier tier.
  muse_spark_1_3: { strength: 6, speed: "standard" },
  // The latest M-series: an agentic MoE that out-scores M3 at half its price.
  minimax_m3_1_flash: { strength: 6, speed: "fast" },
  // Mistral's open-weight flagship; dependable and now a reasoning model.
  mistral_large_4: { strength: 7, speed: "standard" },
  // A post-trained K3: stronger on agentic and coding work, a third cheaper,
  // and it always thinks — never the quick option.
  kimi_k3_1_pro: { strength: 7, speed: "deliberate" },
  // Search-grounded specialist: answers cite the live web, which changes the
  // output's character for a prompt-rewriting task, and it bills a
  // per-request search fee the per-token cost model can't see. Manual pick
  // only — Auto never lands a user on it by surprise. (Its legacy chat
  // endpoint is also sunset; see config.ts.)
  sonar_pro: { strength: 6, speed: "standard", autoExcluded: true },
  // Alibaba's flagship on the new Qwen4 architecture; broad capability, and
  // reviewers note it is slow and verbose at its default effort.
  qwen4_max: { strength: 7, speed: "standard" },
  // xAI's flagship: near-frontier reasoning at a mid-tier price.
  grok_4_7: { strength: 8, speed: "standard" },
  // Zhipu's open-weight flagship; capable, priced below its strength peers.
  glm_5_3: { strength: 6, speed: "standard" },
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

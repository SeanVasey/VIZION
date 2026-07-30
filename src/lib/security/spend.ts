import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { TargetModelId } from "@/lib/constants";
import {
  COST_CAP_USD_PER_DAY,
  RATE_LIMIT_PER_MIN,
  computeCost,
} from "@/lib/providers/config";

const OUTPUT_CEILING: Record<TargetModelId, number> = {
  opus_5: 64_000,
  sonnet_5: 64_000,
  fable_5: 64_000,
  gpt_5_6_sol: 16_000,
  gpt_5_6_luna: 16_000,
  gpt_5_6_terra: 16_000,
  deepseek_v4: 16_000,
  gemini_3_6_flash: 64_000,
  muse_spark_1_1: 16_000,
  minimax_m3: 16_000,
  mistral_large_3: 16_000,
  kimi_k3: 16_000,
  sonar_pro: 16_000,
  qwen3_7_max: 8_192,
  grok_4_5: 16_000,
  glm_5_2: 16_000,
};

export function maxEnhanceCost(
  target: TargetModelId,
  inputChars: number,
  thinking?: string,
): number {
  let output = OUTPUT_CEILING[target];
  if (
    ["opus_5", "sonnet_5", "fable_5"].includes(target) &&
    thinking !== "xhigh" &&
    thinking !== "max"
  )
    output = 32_000;
  if (target === "gemini_3_6_flash" && thinking !== "high") output = 32_000;
  return computeCost(target, Math.ceil(inputChars / 4), output);
}

export function maxVisionCost(target: TargetModelId): number {
  // Five-megabyte images are provider-tokenized differently. 100k input
  // tokens is deliberately conservative; the output adapters cap at 4096.
  return computeCost(target, 100_000, 4_096);
}

export async function reserveSpend(
  supabase: SupabaseClient<Database>,
  maximumCost: number,
): Promise<{ id: string; todayCost: number } | { error: "rate" | "cap" | "db" }> {
  const { data, error } = await supabase.rpc("spend_reserve", {
    p_max_cost: maximumCost,
    p_cap: COST_CAP_USD_PER_DAY,
    p_rate_limit: RATE_LIMIT_PER_MIN,
    p_rate_seconds: 60,
  });
  if (error) {
    if (error.message.includes("rate_limited")) return { error: "rate" };
    if (error.message.includes("cap_reached")) return { error: "cap" };
    return { error: "db" };
  }
  const row = data?.[0];
  return row
    ? { id: row.reservation_id, todayCost: Number(row.today_cost) }
    : { error: "db" };
}

export async function settleSpend(
  supabase: SupabaseClient<Database>,
  reservationId: string,
  usage: {
    target: TargetModelId;
    mode: string;
    modelUsed: string;
    tokenIn: number;
    tokenOut: number;
    costUsd: number;
  },
) {
  return supabase.rpc("spend_settle", {
    p_reservation_id: reservationId,
    p_target: usage.target,
    p_mode: usage.mode,
    p_model_used: usage.modelUsed,
    p_token_in: usage.tokenIn,
    p_token_out: usage.tokenOut,
    p_cost_usd: usage.costUsd,
  });
}

export async function releaseSpend(
  supabase: SupabaseClient<Database>,
  reservationId: string,
) {
  return supabase.rpc("spend_release", { p_reservation_id: reservationId });
}

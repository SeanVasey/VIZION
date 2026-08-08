import "server-only";
import type { TargetModelId } from "@/lib/constants";

export type Provider =
  | "anthropic"
  | "openai"
  | "deepseek"
  | "google"
  | "meta"
  | "minimax"
  | "mistral"
  | "moonshot"
  | "perplexity"
  | "qwen"
  | "xai"
  | "zai";

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
 * Defaults: Opus/Fable use the authoritative Anthropic strings; GPT, Gemini,
 * and Grok default to the named product targets and can be pointed at any
 * deployed string via env.
 */
export const TARGETS: Record<TargetModelId, TargetConfig> = {
  opus_5: {
    provider: "anthropic",
    model: process.env.MODEL_OPUS ?? "claude-opus-5",
    priceIn: numEnv("PRICE_OPUS_IN", 5),
    priceOut: numEnv("PRICE_OPUS_OUT", 25),
  },
  sonnet_5: {
    provider: "anthropic",
    model: process.env.MODEL_SONNET ?? "claude-sonnet-5",
    priceIn: numEnv("PRICE_SONNET_IN", 3),
    priceOut: numEnv("PRICE_SONNET_OUT", 15),
  },
  gpt_5_6_sol: {
    provider: "openai",
    model: process.env.MODEL_GPT ?? "gpt-5.6-sol",
    priceIn: numEnv("PRICE_GPT_IN", 5),
    priceOut: numEnv("PRICE_GPT_OUT", 15),
  },
  gpt_5_6_luna: {
    provider: "openai",
    // The balanced mid tier of the GPT-5.6 family; defaults follow the
    // family's published tiering below Sol — override via env when the
    // deployed rates differ.
    model: process.env.MODEL_GPT_LUNA ?? "gpt-5.6-luna",
    priceIn: numEnv("PRICE_GPT_LUNA_IN", 1),
    priceOut: numEnv("PRICE_GPT_LUNA_OUT", 4),
  },
  gpt_5_6_terra: {
    provider: "openai",
    // The fast, light tier of the GPT-5.6 family.
    model: process.env.MODEL_GPT_TERRA ?? "gpt-5.6-terra",
    priceIn: numEnv("PRICE_GPT_TERRA_IN", 0.2),
    priceOut: numEnv("PRICE_GPT_TERRA_OUT", 0.8),
  },
  fable_5: {
    provider: "anthropic",
    model: process.env.MODEL_FABLE ?? "claude-fable-5",
    priceIn: numEnv("PRICE_FABLE_IN", 10),
    priceOut: numEnv("PRICE_FABLE_OUT", 50),
  },
  deepseek_v4: {
    provider: "deepseek",
    // Pinned to the exact flagship id (PRV-007 — the floating `deepseek-chat`
    // alias let an upstream swap silently change behavior and invalidate this
    // price row). Id + rates from api-docs.deepseek.com, 2026-08-01; input
    // rate is the cache-miss figure (the conservative one for the cap).
    model: process.env.MODEL_DEEPSEEK ?? "deepseek-v4-pro",
    priceIn: numEnv("PRICE_DEEPSEEK_IN", 0.435),
    priceOut: numEnv("PRICE_DEEPSEEK_OUT", 0.87),
  },
  gemini_3_6_flash: {
    provider: "google",
    // "Thinking" and "Fast" in Gemini's app are thinkingLevel values on this
    // ONE model — there is no `gemini-3.6-thinking` model string (it would
    // 404). Reasoning depth rides the per-request thinking selector
    // (EnhanceArgs.thinkingLevel), not a second roster entry.
    model: process.env.MODEL_GEMINI ?? "gemini-3.6-flash",
    priceIn: numEnv("PRICE_GEMINI_IN", 1.5),
    priceOut: numEnv("PRICE_GEMINI_OUT", 7.5),
  },
  muse_spark_1_1: {
    provider: "meta",
    // Meta Model API's Muse Spark 1.1 (Meta Superintelligence Labs) — the
    // closed-weights successor to the retired Llama API line.
    model: process.env.MODEL_MUSE ?? "muse-spark-1.1",
    priceIn: numEnv("PRICE_MUSE_IN", 1.25),
    priceOut: numEnv("PRICE_MUSE_OUT", 4.25),
  },
  minimax_m3: {
    provider: "minimax",
    // M3 launch rates match the M2-series list pricing; override PRICE_MINIMAX_*
    // if MiniMax publishes different rates.
    model: process.env.MODEL_MINIMAX ?? "MiniMax-M3",
    priceIn: numEnv("PRICE_MINIMAX_IN", 0.3),
    priceOut: numEnv("PRICE_MINIMAX_OUT", 1.2),
  },
  mistral_large_3: {
    provider: "mistral",
    // STILL FLOATING (PRV-007, deliberate): Mistral publishes no exact wire
    // string for the current Large 3 (v25.12) — only deprecated versions show
    // the dated pattern (mistral-large-2411/-2407), and pinning an INFERRED
    // "mistral-large-2512" risks 404ing every call (the invented-model-string
    // incident class). Pin via MODEL_MISTRAL the day Mistral publishes the id;
    // procedure in docs/runbooks/providers.md.
    model: process.env.MODEL_MISTRAL ?? "mistral-large-latest",
    priceIn: numEnv("PRICE_MISTRAL_IN", 2),
    priceOut: numEnv("PRICE_MISTRAL_OUT", 6),
  },
  kimi_k3: {
    provider: "moonshot",
    // K3 launch rates match the K2-series list pricing; override PRICE_KIMI_*
    // if Moonshot publishes different rates.
    model: process.env.MODEL_KIMI ?? "kimi-k3",
    priceIn: numEnv("PRICE_KIMI_IN", 0.6),
    priceOut: numEnv("PRICE_KIMI_OUT", 2.5),
  },
  sonar_pro: {
    provider: "perplexity",
    model: process.env.MODEL_SONAR ?? "sonar-pro",
    priceIn: numEnv("PRICE_SONAR_IN", 3),
    priceOut: numEnv("PRICE_SONAR_OUT", 15),
  },
  qwen3_8_max: {
    provider: "qwen",
    // Pinned to the exact release id (PRV-007) — Model Studio lists the release
    // verbatim (alibabacloud.com/help/en/model-studio/models), so the roster
    // label and the wire string agree. Never a floating alias: `qwen-max`
    // silently follows whatever Alibaba promotes, which is how a pinned build
    // starts billing a different model without a diff.
    model: process.env.MODEL_QWEN ?? "qwen3.8-max",
    priceIn: numEnv("PRICE_QWEN_IN", 1.25),
    priceOut: numEnv("PRICE_QWEN_OUT", 3.75),
  },
  grok_4_5: {
    provider: "xai",
    model: process.env.MODEL_GROK ?? "grok-4.5",
    priceIn: numEnv("PRICE_GROK_IN", 3),
    priceOut: numEnv("PRICE_GROK_OUT", 15),
  },
  glm_5_2: {
    provider: "zai",
    // GLM-5.2 list rates are unpublished at launch — defaults are the GLM-5
    // reference rates; override PRICE_GLM_* when Z.ai publishes them.
    // MODEL_GLM also absorbs any long-context variant serving string.
    model: process.env.MODEL_GLM ?? "glm-5.2",
    priceIn: numEnv("PRICE_GLM_IN", 1),
    priceOut: numEnv("PRICE_GLM_OUT", 3.2),
  },
};

export function numEnv(name: string, fallback: number): number {
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

/**
 * Uniform provider connection policy (PRV-002). A provider connection that
 * outlives the route's maxDuration is killed by the platform, which skips the
 * finally-block that settles/releases the spend hold. Every adapter therefore
 * bounds its own request UNDER the window, and zero SDK retries — an invisible
 * retry both risks running past the window and can double-bill upstream
 * without a ledger row.
 *
 * TWO BUDGETS, NOT ONE, AND WHY.
 * This was a single `PROVIDER_TIMEOUT_MS = 55_000` passed as the SDKs'
 * `timeout`. That option is a WHOLE-REQUEST deadline — it covers the streamed
 * body read, not just connect — so it could not tell "hung connection" from
 * "healthy generation that is simply long", and killed both at 55s. At typical
 * rates that capped output at roughly 2,000-4,000 tokens against the
 * 16,000-64,000 the adapters actually request: the clock, not max_tokens, was
 * the real ceiling, and the truncated run was still billed. Splitting it:
 *
 *   IDLE  — time since the last token. A hung connection still dies fast; a
 *           stream that keeps producing is never interrupted. This is the one
 *           that should fire in anger.
 *   TOTAL — a backstop under the route's maxDuration (300s) so the finally
 *           block always runs and the spend hold is never stranded.
 */
export const PROVIDER_IDLE_MS = numEnv("PROVIDER_IDLE_MS", 60_000);
export const PROVIDER_TOTAL_MS = numEnv("PROVIDER_TOTAL_MS", 285_000);
export const PROVIDER_MAX_RETRIES = 0;

/**
 * The MEDIA path keeps a single whole-request deadline, and should.
 *
 * /api/media is a bounded one-shot analysis (max_tokens 1024-4096) whose route
 * still declares maxDuration=60, and nothing about it streams to the user. The
 * failure the split above fixes — a healthy long generation cut mid-flight —
 * cannot occur here, so a flat deadline under the platform window is the
 * simpler correct policy. Deliberately a separate constant: sharing one with
 * the enhance path is what let a value sized for bounded calls govern
 * unbounded streaming ones.
 */
export const MEDIA_TIMEOUT_MS = numEnv("MEDIA_TIMEOUT_MS", 55_000);

/** Per-user limits (env-overridable). Enforced on every model route. */
export const RATE_LIMIT_PER_MIN = numEnv("RATE_LIMIT_PER_MIN", 20);
export const COST_CAP_USD_PER_DAY = numEnv("COST_CAP_USD_PER_DAY", 2);

/** Env var holding each provider's API key (keys are server-side only). */
export const PROVIDER_KEY_ENV: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  google: "GOOGLE_API_KEY",
  meta: "META_API_KEY",
  minimax: "MINIMAX_API_KEY",
  mistral: "MISTRAL_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  qwen: "DASHSCOPE_API_KEY",
  xai: "XAI_API_KEY",
  zai: "ZAI_API_KEY",
};

/** Whether a target's provider has its key set — lets routes fail a missing
 *  key as a plain pre-stream 503 instead of discovering it mid-stream. */
export function isProviderConfigured(target: TargetModelId): boolean {
  return Boolean(process.env[PROVIDER_KEY_ENV[TARGETS[target].provider]]);
}

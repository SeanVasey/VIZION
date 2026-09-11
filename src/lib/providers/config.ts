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
  /** USD per 1M input / output tokens, for the cost cap — and, since the
   *  score-based router landed, for Auto's cost ranking (manifest.ts reads
   *  these live, so a PRICE_* override re-ranks Auto too). */
  priceIn: number;
  priceOut: number;
  /** ISO date the prices and model string were last checked against the
   *  vendor's own page (META-01). Bump on every re-verify; models.test.tsx
   *  pins presence + format, deliberately NOT age — a test that starts
   *  failing by calendar time breaks "ship-ready every commit". */
  pricesVerifiedAt: string;
  /** Set when a row carries a carry-over/reference rate rather than a
   *  vendor-published one; every such row is named in the runbook's
   *  provisional-price note (PRV-008). Absent = vendor-verified. */
  pricesAssumed?: true;
}

/**
 * Target → provider + model-string mapping. Model strings live here (env-
 * overridable) so swapping a model is config, not a refactor (FINAL_PLAN D9).
 * Defaults: Opus/Fable use the authoritative Anthropic strings; GPT, Gemini,
 * and Grok default to the named product targets and can be pointed at any
 * deployed string via env.
 */
export const TARGETS: Record<TargetModelId, TargetConfig> = {
  // Every row below was re-read from the vendor's own page on 2026-09-11
  // (the second full re-verify; the first was 2026-08-08). Where a vendor
  // lists an introductory or promotional rate beside the base one, the BASE
  // rate is carried: overcounting the cap for a few weeks is the safe side of
  // a spend limit (the Sonnet precedent, now closed — see its row).
  opus_5: {
    provider: "anthropic",
    model: process.env.MODEL_OPUS ?? "claude-opus-5",
    priceIn: numEnv("PRICE_OPUS_IN", 5),
    priceOut: numEnv("PRICE_OPUS_OUT", 25),
    pricesVerifiedAt: "2026-09-11",
  },
  sonnet_5: {
    provider: "anthropic",
    // platform.claude.com now lists $2/$10 as the BASE rate (the 2026-08 row
    // carried the $3/$15 standard figure while the intro price ran; the intro
    // price became the price).
    model: process.env.MODEL_SONNET ?? "claude-sonnet-5",
    priceIn: numEnv("PRICE_SONNET_IN", 2),
    priceOut: numEnv("PRICE_SONNET_OUT", 10),
    pricesVerifiedAt: "2026-09-11",
  },
  gpt_6_astra: {
    provider: "openai",
    // OpenAI's tier above the 5.6 family (developers.openai.com/api/docs/
    // models/gpt-6-astra): $10/$50, 128k max output, reasoning_effort
    // low…max via Chat Completions. `none` returns 400 on this model — never
    // sent (the ladder's floor is `low`).
    model: process.env.MODEL_GPT_ASTRA ?? "gpt-6-astra",
    priceIn: numEnv("PRICE_GPT_ASTRA_IN", 10),
    priceOut: numEnv("PRICE_GPT_ASTRA_OUT", 50),
    pricesVerifiedAt: "2026-09-11",
  },
  gpt_5_6_sol: {
    provider: "openai",
    // developers.openai.com lists $4/$20 as a PROMOTIONAL rate through at
    // least 2026-11-21; the pre-promo published rate ($5/$30, 2026-08-08) is
    // carried as the base for the cap. Long-context surcharge starts at 272K
    // prompt tokens, unreachable under MAX_INPUT_CHARS.
    model: process.env.MODEL_GPT ?? "gpt-5.6-sol",
    priceIn: numEnv("PRICE_GPT_IN", 5),
    priceOut: numEnv("PRICE_GPT_OUT", 30),
    pricesVerifiedAt: "2026-09-11",
  },
  gpt_5_6_luna: {
    provider: "openai",
    // The SMALL, cost-efficient tier of the GPT-5.6 family. Rates reflect
    // OpenAI's 2026-07-30 price cut, unchanged at the 2026-09 re-verify.
    model: process.env.MODEL_GPT_LUNA ?? "gpt-5.6-luna",
    priceIn: numEnv("PRICE_GPT_LUNA_IN", 0.2),
    priceOut: numEnv("PRICE_GPT_LUNA_OUT", 1.2),
    pricesVerifiedAt: "2026-09-11",
  },
  gpt_5_6_terra: {
    provider: "openai",
    // The BALANCED MID tier of the GPT-5.6 family. Unchanged at the 2026-09
    // re-verify.
    model: process.env.MODEL_GPT_TERRA ?? "gpt-5.6-terra",
    priceIn: numEnv("PRICE_GPT_TERRA_IN", 2),
    priceOut: numEnv("PRICE_GPT_TERRA_OUT", 12),
    pricesVerifiedAt: "2026-09-11",
  },
  fable_5_1: {
    provider: "anthropic",
    // The 2026-09-01 point release; `claude-fable-5-1` is a pinned snapshot
    // (dateless ids are their own snapshot from the 4.6 generation on). Same
    // $10/$50 list rate as Fable 5, which is now on the legacy list.
    model: process.env.MODEL_FABLE ?? "claude-fable-5-1",
    priceIn: numEnv("PRICE_FABLE_IN", 10),
    priceOut: numEnv("PRICE_FABLE_OUT", 50),
    pricesVerifiedAt: "2026-09-11",
  },
  deepseek_v4: {
    provider: "deepseek",
    // `deepseek-v4-pro` is served by the V4-Pro-0813 snapshot (PRV-007: the
    // id is the vendor's own pinned name, never the floating `deepseek-chat`).
    // The announced increase LANDED 2026-08-16 — the permanent 75% discount
    // ended — and the rate is now time-of-day tiered. The PEAK rate (cache
    // miss) is carried: the cap must not undercount a run that lands in
    // peak hours (01:00–04:00 and 06:00–10:00 UTC, weekdays); off-peak is
    // exactly half.
    model: process.env.MODEL_DEEPSEEK ?? "deepseek-v4-pro",
    priceIn: numEnv("PRICE_DEEPSEEK_IN", 1.32),
    priceOut: numEnv("PRICE_DEEPSEEK_OUT", 3.96),
    pricesVerifiedAt: "2026-09-11",
  },
  gemini_3_8_flash: {
    provider: "google",
    // Google's frontier line is the Flash line (ai.google.dev/gemini-api/
    // docs/latest-model): `gemini-3.8-flash`, 64k max output, thinkingLevel
    // low · medium (default) · high — `minimal` is NOT accepted on 3.8. The
    // listed $0.75/$3.75 is INTRODUCTORY through 2026-12-31; 3.6 Flash's
    // $1.50/$7.50 standard rate is carried as the base so the cap overcounts
    // during the promo rather than undercounting after it (output includes
    // thinking tokens).
    model: process.env.MODEL_GEMINI ?? "gemini-3.8-flash",
    priceIn: numEnv("PRICE_GEMINI_IN", 1.5),
    priceOut: numEnv("PRICE_GEMINI_OUT", 7.5),
    pricesVerifiedAt: "2026-09-11",
  },
  muse_spark_1_1: {
    provider: "meta",
    // Meta Model API's Muse Spark 1.1 (Meta Superintelligence Labs). Standard
    // -tier rates corroborated across OpenRouter and pricing trackers (Meta's
    // own model page resists scraping); the opt-in "contributor" tier's
    // cheaper rates trade prompts for training data and are deliberately not
    // used. Unchanged at the 2026-09 re-verify.
    model: process.env.MODEL_MUSE ?? "muse-spark-1.1",
    priceIn: numEnv("PRICE_MUSE_IN", 1.25),
    priceOut: numEnv("PRICE_MUSE_OUT", 4.25),
    pricesVerifiedAt: "2026-09-11",
  },
  minimax_m3: {
    provider: "minimax",
    // platform.minimax.io's pricing page could not be read at the 2026-09
    // re-verify (the model page confirms `MiniMax-M3` is still the flagship);
    // third-party listings show $0.23/$0.96, BELOW the 2026-08 vendor figure,
    // so the higher 2026-08 rate stays as the safe side. Basis note from
    // 2026-08 still applies: a list price with a "permanent 50% off" — if the
    // promo ends every figure doubles.
    model: process.env.MODEL_MINIMAX ?? "MiniMax-M3",
    priceIn: numEnv("PRICE_MINIMAX_IN", 0.3),
    priceOut: numEnv("PRICE_MINIMAX_OUT", 1.2),
    pricesVerifiedAt: "2026-08-08",
  },
  mistral_large_3: {
    provider: "mistral",
    // PINNED 2026-08-08 to the versioned id on the Large 3 model card
    // (docs.mistral.ai, mistral-large-2512). At the 2026-09 re-verify the
    // models overview no longer surfaces the Large line's ids and the
    // pricing page only repeats "$0.5 / $1.5 for Mistral Large" — so the id
    // and rate are carried, NOT re-verified. A 401 on this target is the
    // KEY being refused (see the adapter's message); a 404 would be this id
    // being retired — point MODEL_MISTRAL at the current Large string.
    model: process.env.MODEL_MISTRAL ?? "mistral-large-2512",
    priceIn: numEnv("PRICE_MISTRAL_IN", 0.5),
    priceOut: numEnv("PRICE_MISTRAL_OUT", 1.5),
    pricesVerifiedAt: "2026-08-08",
  },
  kimi_k3: {
    provider: "moonshot",
    // Official platform.kimi.ai rates (platform.moonshot.ai redirects there).
    // K3 always thinks; `reasoning_effort` defaults to MAX (the adapter now
    // sends the dial's level, which is what stopped every untuned Kimi run
    // from being the slowest in the fleet). Input is the cache-miss figure.
    model: process.env.MODEL_KIMI ?? "kimi-k3",
    priceIn: numEnv("PRICE_KIMI_IN", 3),
    priceOut: numEnv("PRICE_KIMI_OUT", 15),
    pricesVerifiedAt: "2026-08-08",
  },
  sonar_pro: {
    provider: "perplexity",
    // Token rates only: Perplexity also bills a PER-REQUEST search fee
    // (~$6/1k requests at the default search_context_size) that a per-token
    // table cannot express — an accepted, documented undercount of well under
    // a cent per run (docs/runbooks/providers.md). Unchanged 2026-09.
    model: process.env.MODEL_SONAR ?? "sonar-pro",
    priceIn: numEnv("PRICE_SONAR_IN", 3),
    priceOut: numEnv("PRICE_SONAR_OUT", 15),
    pricesVerifiedAt: "2026-09-11",
  },
  qwen3_8_max: {
    provider: "qwen",
    // Pinned to the exact release id (PRV-007) — Model Studio lists
    // `qwen3.8-max` verbatim (alibabacloud.com/help/en/model-studio/
    // qwen3-8-max; the 0902 snapshot is an alias of it), so the roster label
    // and the wire string agree. Never a floating alias. Rates are the
    // International/Singapore region's — every other region runs ~18%
    // cheaper, so set PRICE_QWEN_* to match the account's actual billing
    // region. The same page lists a 131,072-token output ceiling and a
    // 262,144-token thinking ceiling — see MAX_TOKENS_QWEN in openai-compat.
    model: process.env.MODEL_QWEN ?? "qwen3.8-max",
    priceIn: numEnv("PRICE_QWEN_IN", 2),
    priceOut: numEnv("PRICE_QWEN_OUT", 6),
    pricesVerifiedAt: "2026-09-11",
  },
  grok_4_6: {
    provider: "xai",
    // docs.x.ai: `grok-4.6` at the same $2/$6 standard tier as 4.5 (<200K
    // prompt tokens — the 2× long-context tier is unreachable under
    // MAX_INPUT_CHARS). 4.6 adds `xhigh` to reasoning_effort; reasoning still
    // cannot be disabled and defaults to high.
    model: process.env.MODEL_GROK ?? "grok-4.6",
    priceIn: numEnv("PRICE_GROK_IN", 2),
    priceOut: numEnv("PRICE_GROK_OUT", 6),
    pricesVerifiedAt: "2026-09-11",
  },
  glm_5_3: {
    provider: "zai",
    // docs.z.ai/guides/llm/glm-5.3: `glm-5.3`, 128k max output, always
    // reasoning, `reasoning_effort` low · high · max (default max). The model
    // page does not publish a rate, so GLM-5.2's official international rate
    // is carried as a reference figure (PRV-008) until Z.ai lists 5.3's.
    model: process.env.MODEL_GLM ?? "glm-5.3",
    priceIn: numEnv("PRICE_GLM_IN", 1.4),
    priceOut: numEnv("PRICE_GLM_OUT", 4.4),
    pricesVerifiedAt: "2026-09-11",
    pricesAssumed: true,
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
 * WHAT THE SDK `timeout` COVERS, measured rather than assumed. In both
 * vendored SDKs the timer is armed around `fetch()` and cleared as soon as
 * that promise settles (openai/src/core.ts:597-602;
 * @anthropic-ai/sdk/src/client.ts:729-733). A streaming `fetch()` resolves at
 * the RESPONSE HEADERS, so `timeout` bounds connect-and-headers and nothing
 * after. Once the first byte lands, the SDK stops bounding the stream.
 *
 * That corrects an earlier claim in this file that `timeout` was a
 * whole-request deadline covering the body read. It never was — which means
 * the old `PROVIDER_TIMEOUT_MS = 55_000` was NOT what truncated long runs
 * mid-stream. The route's `maxDuration = 60` was: the platform killed the
 * whole function. Hence the raised window is the primary fix, not a secondary
 * one, and the two budgets below cover what the SDK does not:
 *
 *   IDLE  — time since the last token, enforced by withIdleTimeout. A hung
 *           connection dies fast; a stream that keeps producing is never
 *           interrupted. This is the one that should fire in anger.
 *   TOTAL — an ABSOLUTE wall across the whole invocation, taken ONCE by the
 *           route at entry (so its own preflight counts) and enforced by
 *           withIdleTimeout, by hand in google.ts, and as the SDK clients'
 *           connect-and-headers `timeout`. It cannot live on the SDK client
 *           alone, because that timer is already gone by the time the body
 *           streams; a continuously productive stream would otherwise outlive
 *           it and be killed by the platform instead, skipping the route's
 *           finally block and stranding the spend hold.
 *
 * TOTAL IS A WALL, NOT A DURATION TO RE-USE — and that distinction is the
 * whole lesson of PR #91, where six review rounds each moved the timer one
 * layer outward while the layer below went on arming a fresh full-length one
 * from this constant. Two budgets that each read 285_000 do not add up to 285
 * seconds; they add up to 570. So this value is converted to an absolute
 * deadline in exactly one place — `providerDeadline()` — and every timer below
 * that is cut from `remainingMs(deadline)`. Nothing else may read it as a
 * duration, and `tests/unit/provider-policy.test.ts` fails the build if
 * anything does. Sized under the route's maxDuration (300s).
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

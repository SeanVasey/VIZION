import "server-only";
import type { TargetModelId } from "@/lib/constants";
import type { EffortVocabulary } from "@/lib/providers/errors";

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
  /** Which effort words THIS model's API accepts — the shape the adapter
   *  translates the app's ladder onto (`providerEffort`, errors.ts). Per
   *  target, not per provider: Gemini 4 Carbon stops at `high` where Neon
   *  and Hydrogen add `xhigh`. Absent = no per-request reasoning knob, and
   *  `TARGET_HAS_THINKING` (constants.ts, the client's copy of this fact)
   *  must say false — models.test.tsx pins the two together. */
  effort?: EffortVocabulary;
}

/**
 * Target → provider + model-string mapping. Model strings live here (env-
 * overridable) so swapping a model is config, not a refactor (FINAL_PLAN D9).
 * Every default is the vendor's own id for the named product; any of them
 * can be pointed at another deployed string via its MODEL_* variable.
 *
 * A MODEL_* override OUTLIVES a roster move: the slot keeps the variable
 * name, so a deployment that still sets MODEL_OPUS=claude-opus-5 goes on
 * calling Opus 5 under the Opus 5.5 label and price. After a roster bump,
 * clear the overrides you no longer mean (docs/runbooks/providers.md).
 */
export const TARGETS: Record<TargetModelId, TargetConfig> = {
  // Every row below was re-read from the vendor's own page on 2026-11-28
  // (the third full re-verify; 2026-08-08 and 2026-09-11 came before). Where
  // a vendor lists an introductory or promotional rate beside the base one,
  // the BASE rate is carried: overcounting the cap for a few weeks is the
  // safe side of a spend limit.
  fable_5_2: {
    provider: "anthropic",
    // The successor to Fable 5.1 at a LOWER list rate ($8/$40, was $10/$50).
    // Dateless ids are their own pinned snapshot from the 4.6 generation on.
    model: strEnv("MODEL_FABLE", "claude-fable-5-2"),
    priceIn: numEnv("PRICE_FABLE_IN", 8),
    priceOut: numEnv("PRICE_FABLE_OUT", 40),
    pricesVerifiedAt: "2026-11-28",
    effort: "five",
  },
  opus_5_5: {
    provider: "anthropic",
    // $4/$20, down from Opus 5's $5/$25. Thinking can no longer be disabled
    // and the VENDOR default effort dropped to `medium` — immaterial here,
    // since the route always resolves a level and sends it.
    model: strEnv("MODEL_OPUS", "claude-opus-5-5"),
    priceIn: numEnv("PRICE_OPUS_IN", 4),
    priceOut: numEnv("PRICE_OPUS_OUT", 20),
    pricesVerifiedAt: "2026-11-28",
    effort: "five",
  },
  sonnet_5_5: {
    provider: "anthropic",
    model: strEnv("MODEL_SONNET", "claude-sonnet-5-5"),
    priceIn: numEnv("PRICE_SONNET_IN", 2),
    priceOut: numEnv("PRICE_SONNET_OUT", 10),
    pricesVerifiedAt: "2026-11-28",
    effort: "five",
  },
  haiku_5_5: {
    provider: "anthropic",
    // The small tier. $0.10/$0.50 holds for prompts up to 100K tokens (it
    // is $0.50/$2.50 beyond) — a boundary MAX_INPUT_CHARS keeps two orders
    // of magnitude away.
    model: strEnv("MODEL_HAIKU", "claude-haiku-5-5"),
    priceIn: numEnv("PRICE_HAIKU_IN", 0.1),
    priceOut: numEnv("PRICE_HAIKU_OUT", 0.5),
    pricesVerifiedAt: "2026-11-28",
    effort: "five",
  },
  gpt_6_2_astra: {
    provider: "openai",
    // developers.openai.com/api/docs/models/gpt-6.2-astra: $8/$40 (20% under
    // GPT-6 Astra), 128k max output, reasoning_effort via Chat Completions.
    // `none` is rejected on the 6.2 pair — never sent (the ladder's floor is
    // `low`). Long-context surcharge starts at 272K prompt tokens,
    // unreachable under MAX_INPUT_CHARS.
    model: strEnv("MODEL_GPT_ASTRA", "gpt-6.2-astra"),
    priceIn: numEnv("PRICE_GPT_ASTRA_IN", 8),
    priceOut: numEnv("PRICE_GPT_ASTRA_OUT", 40),
    pricesVerifiedAt: "2026-11-28",
    effort: "openai",
  },
  gpt_6_2_sol: {
    provider: "openai",
    // The everyday flagship: $2/$10, the rate GPT-6.1 Sol carried. This row
    // was $5/$30 for GPT-5.6 Sol — the slot got cheaper AND stronger, which
    // moves it up every Auto ladder (manifest.ts reads these prices live).
    model: strEnv("MODEL_GPT", "gpt-6.2-sol"),
    priceIn: numEnv("PRICE_GPT_IN", 2),
    priceOut: numEnv("PRICE_GPT_OUT", 10),
    pricesVerifiedAt: "2026-11-28",
    effort: "openai",
  },
  gpt_6_1_terra: {
    provider: "openai",
    // The balanced mid tier, still on 6.1: $1/$5.
    model: strEnv("MODEL_GPT_TERRA", "gpt-6.1-terra"),
    priceIn: numEnv("PRICE_GPT_TERRA_IN", 1),
    priceOut: numEnv("PRICE_GPT_TERRA_OUT", 5),
    pricesVerifiedAt: "2026-11-28",
    effort: "openai",
  },
  gpt_6_luna: {
    provider: "openai",
    // The small tier, still on 6: $0.10/$0.50 standard (the $0.05/$0.25
    // figure on the pricing page is the Flex/Batch rate, which this adapter
    // does not use).
    model: strEnv("MODEL_GPT_LUNA", "gpt-6-luna"),
    priceIn: numEnv("PRICE_GPT_LUNA_IN", 0.1),
    priceOut: numEnv("PRICE_GPT_LUNA_OUT", 0.5),
    pricesVerifiedAt: "2026-11-28",
    effort: "openai",
  },
  deepseek_v4: {
    provider: "deepseek",
    // `deepseek-v4-pro` still serves the V4-Pro-0813 snapshot and is still
    // the API's strongest model: the changelog's only newer entry is
    // V4.1-Flash (2026-10-17), a throughput tier. The rate is time-of-day
    // tiered; the PEAK rate (cache miss) is carried so the cap never
    // undercounts a run that lands in peak hours (01:00–04:00 and
    // 06:00–10:00 UTC, weekdays). Off-peak is exactly half.
    model: strEnv("MODEL_DEEPSEEK", "deepseek-v4-pro"),
    priceIn: numEnv("PRICE_DEEPSEEK_IN", 1.32),
    priceOut: numEnv("PRICE_DEEPSEEK_OUT", 3.96),
    pricesVerifiedAt: "2026-11-28",
    effort: "three",
  },
  gemini_4_carbon: {
    provider: "google",
    // Google's strongest reasoning model. aistudio.google.com/docs/pricing
    // lists $2/$10 as an INTRODUCTORY rate through 2026-11-30 and $4/$20
    // from 2026-12-01; the base rate is carried (the promo had two days
    // left when this row was written). thinkingLevel low · medium (default)
    // · high — no `xhigh`, unlike its two siblings.
    model: strEnv("MODEL_GEMINI_CARBON", "gemini-4-carbon"),
    priceIn: numEnv("PRICE_GEMINI_CARBON_IN", 4),
    priceOut: numEnv("PRICE_GEMINI_CARBON_OUT", 20),
    pricesVerifiedAt: "2026-11-28",
    effort: "toHigh",
  },
  gemini_4_neon: {
    provider: "google",
    // Between Hydrogen and Carbon; the one Google points at complex
    // engineering work. $3/$15, no promo, no free tier. thinkingLevel low ·
    // medium · high (default) · xhigh.
    model: strEnv("MODEL_GEMINI_NEON", "gemini-4-neon"),
    priceIn: numEnv("PRICE_GEMINI_NEON_IN", 3),
    priceOut: numEnv("PRICE_GEMINI_NEON_OUT", 15),
    pricesVerifiedAt: "2026-11-28",
    effort: "toXhigh",
  },
  gemini_4_hydrogen: {
    provider: "google",
    // The fast general-purpose default, and the old Flash slot: the same
    // $1.50/$7.50 this row already carried as 3.x Flash's base rate, so
    // MODEL_GEMINI / PRICE_GEMINI_* keep their names. 65,536 max output per
    // request; thinkingLevel low · medium · high (default) · xhigh, and
    // `minimal` is rejected (output includes thinking tokens).
    model: strEnv("MODEL_GEMINI", "gemini-4-hydrogen"),
    priceIn: numEnv("PRICE_GEMINI_IN", 1.5),
    priceOut: numEnv("PRICE_GEMINI_OUT", 7.5),
    pricesVerifiedAt: "2026-11-28",
    effort: "toXhigh",
  },
  muse_wonder_1_0: {
    provider: "meta",
    // "Meta's most capable model" (dev.meta.ai/docs/models) — in PREVIEW on
    // the pay-as-you-go Model API, Standard mode only, and not offered in
    // every region. reasoning_effort minimal…max, VENDOR DEFAULT max;
    // `none` is a 400.
    model: strEnv("MODEL_MUSE_WONDER", "muse-wonder-1.0"),
    priceIn: numEnv("PRICE_MUSE_WONDER_IN", 4),
    priceOut: numEnv("PRICE_MUSE_WONDER_OUT", 20),
    pricesVerifiedAt: "2026-11-28",
    effort: "five",
  },
  muse_spark_1_3: {
    provider: "meta",
    // The recommended Spark version, same Standard-tier rate as 1.1 and 1.2.
    // The "-contributor" variant's cheaper rate trades prompts for training
    // data and is deliberately not used. reasoning_effort minimal…max,
    // default high — the knob arrived with 1.2.
    model: strEnv("MODEL_MUSE", "muse-spark-1.3"),
    priceIn: numEnv("PRICE_MUSE_IN", 1.25),
    priceOut: numEnv("PRICE_MUSE_OUT", 4.25),
    pricesVerifiedAt: "2026-11-28",
    effort: "five",
  },
  minimax_m3_1_flash: {
    provider: "minimax",
    // platform.minimax.io pricing (page modified 2026-11-23): $0.15/$0.60,
    // one rate at any input length, no promo label (M3's $0.30/$1.20 was a
    // "permanent 50% off" list price). reasoning_effort low…max, VENDOR
    // DEFAULT max, and thinking cannot be disabled on this model.
    model: strEnv("MODEL_MINIMAX", "MiniMax-M3.1-Flash"),
    priceIn: numEnv("PRICE_MINIMAX_IN", 0.15),
    priceOut: numEnv("PRICE_MINIMAX_OUT", 0.6),
    pricesVerifiedAt: "2026-11-28",
    effort: "five",
  },
  mistral_large_4: {
    provider: "mistral",
    // PINNED to the versioned id on the model card (docs.mistral.ai/models/
    // mistral-large-4-0, v26.10, marked GA); `mistral-large-4` and
    // `mistral-large-latest` float. $0.70/$2.10 on both the card and the
    // pricing page, with no promo or end date. Large 4 always reasons:
    // reasoning_effort low · medium · high (default high), and it does NOT
    // accept none/minimal/xhigh/max even though the API-wide enum lists
    // them. A 401 on this target is the KEY being refused (see the adapter's
    // message); a 404 would be this id being retired.
    model: strEnv("MODEL_MISTRAL", "mistral-large-4-0"),
    priceIn: numEnv("PRICE_MISTRAL_IN", 0.7),
    priceOut: numEnv("PRICE_MISTRAL_OUT", 2.1),
    pricesVerifiedAt: "2026-11-28",
    effort: "toHigh",
  },
  kimi_k3_1_pro: {
    provider: "moonshot",
    // platform.kimi.ai (quickstart modified 2026-11-20): a post-trained K3
    // at a third less — $2/$10, flat across the context window. Always
    // thinks; reasoning_effort low · high · max, VENDOR DEFAULT max. The
    // `-highspeed` variant is twice the rate and not used.
    model: strEnv("MODEL_KIMI", "kimi-k3.1-pro"),
    priceIn: numEnv("PRICE_KIMI_IN", 2),
    priceOut: numEnv("PRICE_KIMI_OUT", 10),
    pricesVerifiedAt: "2026-11-28",
    effort: "three",
  },
  sonar_pro: {
    provider: "perplexity",
    // ON BORROWED TIME, and priced by carry-over. Perplexity ended Sonar
    // Chat Completions support on 2026-09-27: requests to the legacy
    // endpoint still answer, "reformulated as Agent API requests, rolling
    // out gradually by model", and the pricing page no longer lists a
    // sonar-pro rate at all. The last published $3/$15 is carried as a
    // reference figure (PRV-008) — the only Perplexity model with a current
    // rate, `perplexity/sonar` on the Agent API, is far cheaper, so this
    // overcounts. Moving this slot to the Agent API (a Responses-style
    // endpoint, not a config change) is the open follow-up in
    // docs/runbooks/providers.md.
    model: strEnv("MODEL_SONAR", "sonar-pro"),
    priceIn: numEnv("PRICE_SONAR_IN", 3),
    priceOut: numEnv("PRICE_SONAR_OUT", 15),
    pricesVerifiedAt: "2026-11-28",
    pricesAssumed: true,
  },
  qwen4_max: {
    provider: "qwen",
    // Model Studio lists `qwen4-max` verbatim (alibabacloud.com/help/en/
    // model-studio/qwen4-max); there is no dated snapshot to pin, and the
    // retired `qwen4-max-preview` routes to it. Rates are the International
    // (Singapore) scope's — the Global scope is ~6% cheaper, so set
    // PRICE_QWEN_* to the account's actual billing scope. 25% under
    // Qwen3.8-Max. Reasoning moved from a token BUDGET to an effort word on
    // this generation: reasoning_effort low · high (default) · xhigh.
    model: strEnv("MODEL_QWEN", "qwen4-max"),
    priceIn: numEnv("PRICE_QWEN_IN", 1.5),
    priceOut: numEnv("PRICE_QWEN_OUT", 4.5),
    pricesVerifiedAt: "2026-11-28",
    effort: "threeX",
  },
  grok_4_7: {
    provider: "xai",
    // docs.x.ai (updated 2026-11-25): `grok-4.7` at the same $2/$6 as 4.6
    // (<200K prompt tokens — the 2× long-context tier is unreachable under
    // MAX_INPUT_CHARS). reasoning_effort low · medium · high (default) ·
    // xhigh; reasoning cannot be disabled and `none` is a 400.
    model: strEnv("MODEL_GROK", "grok-4.7"),
    priceIn: numEnv("PRICE_GROK_IN", 2),
    priceOut: numEnv("PRICE_GROK_OUT", 6),
    pricesVerifiedAt: "2026-11-28",
    effort: "toXhigh",
  },
  glm_5_3: {
    provider: "zai",
    // Still Z.ai's API flagship: GLM-5.4 exists but is Coding Plan only
    // ("the Model API will be made available upon completion of the
    // security assessment", docs.z.ai, 2026-11-23). The pricing page now
    // PUBLISHES 5.3's rate — $1.40/$4.40, the figure this row had carried
    // from 5.2 as a reference — so the assumed-price flag is gone. Always
    // reasons; reasoning_effort low · high · max, default max.
    model: strEnv("MODEL_GLM", "glm-5.3"),
    priceIn: numEnv("PRICE_GLM_IN", 1.4),
    priceOut: numEnv("PRICE_GLM_OUT", 4.4),
    pricesVerifiedAt: "2026-11-28",
    effort: "three",
  },
};

/** A string env override, or the fallback when it is unset OR EMPTY.
 *  `.env.example` lists every MODEL_* name with a blank value, and a file
 *  copied from it sets each one to "" — which `??` passes straight through,
 *  sending an empty model id on every call. Blank means "use the default". */
export function strEnv(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v ? v : fallback;
}

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

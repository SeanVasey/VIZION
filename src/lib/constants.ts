/** Shared, UI-facing constants for the VIZION shell. */

export const THEMES = ["dark", "light", "system"] as const;
export type Theme = (typeof THEMES)[number];

/** The enhancement modes (product-spec §4.1). `polish` is the lightest touch —
 *  corrections only — and sits next to `clarify` because both stay close to the
 *  author's original wording and shape. */
export const MODES = [
  { id: "clarify", label: "Clarify" },
  { id: "polish", label: "Polish" },
  { id: "expand", label: "Expand" },
  { id: "condense", label: "Condense" },
  { id: "reformat", label: "Reformat" },
  // Label renamed from "Target" (2026-07 UX audit) — the id stays `target`
  // because it is persisted in the enhance_mode DB enum, localStorage, the
  // offline outbox, and the /api/enhance wire contract. Render stored ids
  // through MODE_LABEL, never raw.
  { id: "target", label: "Adapt" },
] as const;
export type ModeId = (typeof MODES)[number]["id"];

/** Display label for a mode id — the only sanctioned way to render a stored
 *  mode value (ids and labels can diverge, e.g. `target` → "Adapt"). */
export const MODE_LABEL: Record<ModeId, string> = Object.fromEntries(
  MODES.map((m) => [m.id, m.label]),
) as Record<ModeId, string>;

/** Model developers, in locked display order: Anthropic and OpenAI always
 *  first, the rest alphabetical. `DEVELOPER_ORDER` is the single source the
 *  roster (and its ordering test) is checked against. */
export const DEVELOPER_ORDER = [
  "anthropic",
  "openai",
  "deepseek",
  "google",
  "meta",
  "minimax",
  "mistral",
  "moonshot",
  "perplexity",
  "qwen",
  "xai",
  "zai",
] as const;
export type Developer = (typeof DEVELOPER_ORDER)[number];

export const DEVELOPER_LABEL: Record<Developer, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  google: "Google",
  meta: "Meta AI",
  minimax: "MiniMax",
  mistral: "Mistral",
  moonshot: "Moonshot AI",
  perplexity: "Perplexity",
  qwen: "Qwen",
  xai: "xAI",
  zai: "Z.ai",
};

/** The target models (product-spec §4.3, extended). Strings are display
 *  labels; provider model strings live server-side so they can be swapped
 *  freely. IDs are also the DB `model_target` enum values — renaming one
 *  requires a migration (see supabase/migrations). Array order IS display
 *  order everywhere: grouped by developer (per DEVELOPER_ORDER), best model
 *  first within each developer. */
export const TARGET_MODELS = [
  // The 2026-11 frontier re-verify (platform.claude.com, checked 2026-11-28):
  // every Anthropic slot moved a point release — Fable 5.2 ($8/$40, a price
  // cut), Opus 5.5 ($4/$20), Sonnet 5.5 — and the small tier joined the
  // roster as its own slot. Same slot, versioned id — the roster's rule.
  { id: "fable_5_2", label: "Fable 5.2", developer: "anthropic" },
  { id: "opus_5_5", label: "Opus 5.5", developer: "anthropic" },
  { id: "sonnet_5_5", label: "Sonnet 5.5", developer: "anthropic" },
  // Haiku 5.5 is a NEW slot (2026-11): Anthropic's small tier, $0.10/$0.50,
  // the same five effort words as its siblings.
  { id: "haiku_5_5", label: "Haiku 5.5", developer: "anthropic" },
  // Astra > Sol > Terra > Luna is OpenAI's own tiering (frontier / everyday
  // flagship / balanced mid / small). The tiers version independently now:
  // Astra and Sol are 6.2, Terra is 6.1, Luna is 6 (developers.openai.com
  // pricing + model pages, 2026-11-28) — each label carries its own version
  // rather than a family number that would be wrong for two of the four.
  { id: "gpt_6_2_astra", label: "GPT-6.2 Astra", developer: "openai" },
  { id: "gpt_6_2_sol", label: "GPT-6.2 Sol", developer: "openai" },
  { id: "gpt_6_1_terra", label: "GPT-6.1 Terra", developer: "openai" },
  { id: "gpt_6_luna", label: "GPT-6 Luna", developer: "openai" },
  { id: "deepseek_v4", label: "DeepSeek V4 Pro", developer: "deepseek" },
  // Gemini 4 is named by element, not by Pro/Flash, and the names do not
  // sort themselves: Carbon is Google's strongest reasoning model, Neon sits
  // between (and is the one Google points at complex engineering work),
  // Hydrogen is the fast general-purpose default (aistudio.google.com/docs/
  // choosing-a-model, 2026-11-28). Best first, like every other developer.
  // Hydrogen inherits the old Flash slot (same $1.50/$7.50 rate); Carbon and
  // Neon are NEW slots.
  { id: "gemini_4_carbon", label: "Gemini 4 Carbon", developer: "google" },
  { id: "gemini_4_neon", label: "Gemini 4 Neon", developer: "google" },
  { id: "gemini_4_hydrogen", label: "Gemini 4 Hydrogen", developer: "google" },
  // Muse Wonder is "Meta's most capable model" (dev.meta.ai/docs/models,
  // 2026-11-28) — a NEW slot above Spark, in preview on the pay-as-you-go
  // Model API at $4/$20. Spark moved 1.1 → 1.3 in the same slot and price.
  { id: "muse_wonder_1_0", label: "Muse Wonder 1.0", developer: "meta" },
  { id: "muse_spark_1_3", label: "Muse Spark 1.3", developer: "meta" },
  // M3.1 Flash is "the latest M-series language model" (platform.minimax.io,
  // 2026-10-19) and, despite the tier word, the stronger of the two MiniMax
  // serves: half M3's price and the first M-series with an effort knob.
  { id: "minimax_m3_1_flash", label: "MiniMax M3.1 Flash", developer: "minimax" },
  // Mistral Large 4 — the launch post's "le Chonk" is a nickname; the docs,
  // the pricing page and the model list all say Mistral Large 4.
  { id: "mistral_large_4", label: "Mistral Large 4", developer: "mistral" },
  { id: "kimi_k3_1_pro", label: "Kimi K3.1 Pro", developer: "moonshot" },
  { id: "sonar_pro", label: "Sonar Pro", developer: "perplexity" },
  { id: "qwen4_max", label: "Qwen4 Max", developer: "qwen" },
  { id: "grok_4_7", label: "Grok 4.7", developer: "xai" },
  { id: "glm_5_3", label: "GLM-5.3", developer: "zai" },
] as const satisfies readonly { id: string; label: string; developer: Developer }[];
export type TargetModelId = (typeof TARGET_MODELS)[number]["id"];

/** Every id this roster has ever renamed away from, mapped to its replacement.
 *  One entry per `ALTER TYPE model_target RENAME VALUE` in supabase/migrations —
 *  `tests/unit/model-target-enum.test.ts` pins that correspondence, because a
 *  rename with no entry here leaves a stale persisted selection that 400s on
 *  `/api/enhance`. Order is migration order, oldest first. */
export const LEGACY_TARGET_IDS: Record<string, TargetModelId> = {
  gpt_5_5: "gpt_6_2_sol",
  // Renamed four times (gemini_pro_3_1 → gemini_3_5_thinking →
  // gemini_3_6_flash → gemini_3_8_flash → gemini_4_hydrogen). Every link in a
  // rename chain points at the CURRENT id, not the next hop — a value that is
  // no longer a live target fails the enum contract test.
  gemini_pro_3_1: "gemini_4_hydrogen",
  opus_4_8: "opus_5_5",
  llama_4_maverick: "muse_spark_1_3",
  minimax_m2_7: "minimax_m3_1_flash",
  kimi_k2_6: "kimi_k3_1_pro",
  gemini_3_5_thinking: "gemini_4_hydrogen",
  qwen3_7_max: "qwen4_max",
  // The 2026-09 frontier re-verify (20260911120000_frontier_roster).
  fable_5: "fable_5_2",
  gemini_3_6_flash: "gemini_4_hydrogen",
  grok_4_5: "grok_4_7",
  glm_5_2: "glm_5_3",
  // The 2026-11 frontier re-verify (20261128120000_frontier_roster): fourteen
  // of the seventeen slots moved in one pass.
  fable_5_1: "fable_5_2",
  opus_5: "opus_5_5",
  sonnet_5: "sonnet_5_5",
  gpt_6_astra: "gpt_6_2_astra",
  gpt_5_6_sol: "gpt_6_2_sol",
  gpt_5_6_terra: "gpt_6_1_terra",
  gpt_5_6_luna: "gpt_6_luna",
  gemini_3_8_flash: "gemini_4_hydrogen",
  muse_spark_1_1: "muse_spark_1_3",
  minimax_m3: "minimax_m3_1_flash",
  mistral_large_3: "mistral_large_4",
  kimi_k3: "kimi_k3_1_pro",
  qwen3_8_max: "qwen4_max",
  grok_4_6: "grok_4_7",
};

/** Developer for a target id (for the model picker + result chips). */
export const TARGET_DEVELOPER: Record<TargetModelId, Developer> = Object.fromEntries(
  TARGET_MODELS.map((m) => [m.id, m.developer]),
) as Record<TargetModelId, Developer>;

/**
 * Resolve a target id that arrived from OUTSIDE this build to a live one.
 *
 * A roster rename and a deploy are not atomic for a client. A tab left open
 * across the deploy still holds the old id in memory (the persisted store's
 * migration only runs on the next load), and a save queued in the offline
 * outbox carries whatever id was current when it was queued. Both then
 * present a retired id to the server — which is not a bad request, it is a
 * request made one roster ago. Fold it forward instead of 400ing: the 2026-11
 * rename moved the DEFAULT target, so without this every open tab's next run
 * would have failed until its owner thought to reload.
 *
 * Returns undefined for anything that was never a target.
 */
export function resolveTargetId(id: unknown): TargetModelId | undefined {
  if (typeof id !== "string") return undefined;
  if (Object.hasOwn(TARGET_DEVELOPER, id)) return id as TargetModelId;
  return Object.hasOwn(LEGACY_TARGET_IDS, id) ? LEGACY_TARGET_IDS[id] : undefined;
}

/**
 * The reasoning-depth WIRE vocabulary, weakest first. This is what the route
 * accepts, what the drafts table's CHECK lists, and what a persisted store may
 * still carry — a superset of what the dial offers. `minimal` and `xhigh` are
 * legacy stops (Gemini 3.6's floor; Anthropic's second ultra tier) kept so
 * nothing already stored or in flight 400s; `normalizeThinkingLevel` folds
 * them onto the ladder below before anything downstream reads them.
 */
export const THINKING_LEVELS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/**
 * THE ladder — the one every Thinking dial shows, for every model, on every
 * surface. Four stops plus Auto.
 *
 * Until 2026-09 each target carried its own ladder, exactly as its API
 * accepted it (Gemini started at `minimal`, GPT stopped at `high`, Anthropic
 * ran five stops), and the dial reshaped itself per target. That was honest to
 * the wire and wrong for the hand: the same gesture meant a different thing on
 * every model, a level chosen under one model was silently dropped under
 * another, and under Auto the dial showed a ladder for a model that might not
 * run at all (owner direction, 2026-09-11: "make every model use a single or
 * minimal unified way to negate small differences in reasoning level
 * choices"). One ladder, one stored value, and the ADAPTER — the only code
 * that knows a provider's vocabulary — clamps it onto what that provider
 * accepts. The translation table lives in `providers/errors.ts`
 * (`providerEffort`) and is pinned per provider in the adapter tests.
 */
export const THINKING_LADDER = [
  "low",
  "medium",
  "high",
  "max",
] as const satisfies readonly ThinkingLevel[];
export type ThinkingLadderLevel = (typeof THINKING_LADDER)[number];

export const THINKING_LEVEL_LABEL: Record<ThinkingLevel, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

/** Fold a wire-vocabulary level onto the ladder: `minimal` is the floor and
 *  `xhigh` was one step below the top, so each lands on its neighbour. Total
 *  over the wire vocabulary so a stale store or an old client can never carry
 *  a value the ladder does not render. */
export function normalizeThinkingLevel(level: ThinkingLevel): ThinkingLadderLevel {
  if (level === "minimal") return "low";
  if (level === "xhigh") return "high";
  return level;
}

/**
 * Which targets take a per-request reasoning depth at all. A total record, so
 * a new roster entry is a compile error here rather than a silent "no dial".
 * `false` = the provider exposes no knob through our adapters, so the
 * composer shows no Thinking rail for that target (under Auto the rail always
 * shows — routing may land on a knob model, and a level sent toward a
 * knob-less one is advisory there, dropped by the route, never a 400).
 *
 * This is the CLIENT's view. The server's is `TARGETS[id].effort` in
 * providers/config.ts — which vocabulary, not merely whether — and
 * tests/unit/models.test.tsx pins the two to each other, because they are
 * the same fact stated on both sides of the wire.
 *
 * Verified against each vendor's API reference 2026-11-28. Every model on
 * the roster but one now takes an effort word: Mistral (Large 4), Meta (Muse
 * 1.2+) and MiniMax (M3.1) all shipped a knob since the 2026-09 pass.
 */
export const TARGET_HAS_THINKING: Record<TargetModelId, boolean> = {
  fable_5_2: true,
  opus_5_5: true,
  sonnet_5_5: true,
  haiku_5_5: true,
  gpt_6_2_astra: true,
  gpt_6_2_sol: true,
  gpt_6_1_terra: true,
  gpt_6_luna: true,
  deepseek_v4: true,
  gemini_4_carbon: true,
  gemini_4_neon: true,
  gemini_4_hydrogen: true,
  muse_wonder_1_0: true,
  muse_spark_1_3: true,
  minimax_m3_1_flash: true,
  mistral_large_4: true,
  kimi_k3_1_pro: true,
  // Sonar Pro's reasoning control lives on Perplexity's Agent API; the legacy
  // chat endpoint this adapter still calls documents none.
  sonar_pro: false,
  qwen4_max: true,
  grok_4_7: true,
  glm_5_3: true,
};

/** Auto-routing preferences — how Auto weighs strength against price when it
 *  picks the model. A wire vocabulary like the ids above: the client sends one
 *  of these beside `auto: true`, the server validates against this list, and
 *  the ladder each one selects lives server-side (lib/enhance/auto-target).
 *  "balanced" is the default everywhere a preference is absent. */
export const AUTO_PREFERENCES = ["quality", "balanced", "budget"] as const;
export type AutoPreference = (typeof AUTO_PREFERENCES)[number];

export const AUTO_PREFERENCE_LABEL: Record<AutoPreference, string> = {
  quality: "Quality",
  balanced: "Balanced",
  budget: "Budget",
};

/** The enhance route's input ceiling, in characters. Shared with the composer
 *  so the readout can count against the SAME number the route 413s on, rather
 *  than a second copy that drifts. */
export const MAX_INPUT_CHARS = 20_000;

/** localStorage key for the UI store. Local cache is convenience only —
 *  the server is the source of truth for anything that matters. */
export const UI_STORE_KEY = "vizion.ui.v1";

/** localStorage key for the last enhancement result (the composer's view
 *  snapshot). Separate from UI_STORE_KEY on purpose: the UI store re-serializes
 *  its whole state on every draft keystroke, and a result (output + diff) is
 *  orders of magnitude larger than every preference combined. */
export const ENHANCE_VIEW_STORE_KEY = "vizion.enhance-view.v1";

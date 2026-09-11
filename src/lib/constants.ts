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
  // Fable 5.1 is the 2026-09-01 point release (platform.claude.com, checked
  // 2026-09-11): same $10/$50 rate, the same five effort levels, and Fable 5
  // moved to the legacy list. Same slot, versioned id — the roster's rule.
  { id: "fable_5_1", label: "Fable 5.1", developer: "anthropic" },
  { id: "opus_5", label: "Opus 5", developer: "anthropic" },
  { id: "sonnet_5", label: "Sonnet 5", developer: "anthropic" },
  // GPT-6 Astra is OpenAI's frontier tier above the 5.6 family (2026-09
  // re-verify) — a NEW slot, not a rename: the 5.6 tiers stay served and
  // priced as their own products.
  { id: "gpt_6_astra", label: "GPT-6 Astra", developer: "openai" },
  // Sol > Terra > Luna is OpenAI's own tiering (flagship / balanced mid /
  // small) — the roster briefly had Terra and Luna's roles swapped, which the
  // 2026-08 pricing re-verify corrected.
  { id: "gpt_5_6_sol", label: "GPT-5.6 Sol", developer: "openai" },
  { id: "gpt_5_6_terra", label: "GPT-5.6 Terra", developer: "openai" },
  { id: "gpt_5_6_luna", label: "GPT-5.6 Luna", developer: "openai" },
  { id: "deepseek_v4", label: "DeepSeek V4 Pro", developer: "deepseek" },
  // Google's frontier line is the Flash line (3.6 → 3.7 → 3.8 in eight
  // weeks; the newest Pro on the model list is still 3.1). 3.8 is the slot.
  { id: "gemini_3_8_flash", label: "Gemini 3.8 Flash", developer: "google" },
  { id: "muse_spark_1_1", label: "Muse Spark 1.1", developer: "meta" },
  { id: "minimax_m3", label: "MiniMax M3", developer: "minimax" },
  { id: "mistral_large_3", label: "Mistral Large 3", developer: "mistral" },
  { id: "kimi_k3", label: "Kimi K3", developer: "moonshot" },
  { id: "sonar_pro", label: "Sonar Pro", developer: "perplexity" },
  { id: "qwen3_8_max", label: "Qwen3.8 Max", developer: "qwen" },
  { id: "grok_4_6", label: "Grok 4.6", developer: "xai" },
  { id: "glm_5_3", label: "GLM-5.3", developer: "zai" },
] as const satisfies readonly { id: string; label: string; developer: Developer }[];
export type TargetModelId = (typeof TARGET_MODELS)[number]["id"];

/** Every id this roster has ever renamed away from, mapped to its replacement.
 *  One entry per `ALTER TYPE model_target RENAME VALUE` in supabase/migrations —
 *  `tests/unit/model-target-enum.test.ts` pins that correspondence, because a
 *  rename with no entry here leaves a stale persisted selection that 400s on
 *  `/api/enhance`. Order is migration order, oldest first. */
export const LEGACY_TARGET_IDS: Record<string, TargetModelId> = {
  gpt_5_5: "gpt_5_6_sol",
  // Renamed three times (gemini_pro_3_1 → gemini_3_5_thinking →
  // gemini_3_6_flash → gemini_3_8_flash). Every link in a rename chain points
  // at the CURRENT id, not the next hop — a value that is no longer a live
  // target fails the enum contract test.
  gemini_pro_3_1: "gemini_3_8_flash",
  opus_4_8: "opus_5",
  llama_4_maverick: "muse_spark_1_1",
  minimax_m2_7: "minimax_m3",
  kimi_k2_6: "kimi_k3",
  gemini_3_5_thinking: "gemini_3_8_flash",
  qwen3_7_max: "qwen3_8_max",
  // The 2026-09 frontier re-verify (20260911120000_frontier_roster).
  fable_5: "fable_5_1",
  gemini_3_6_flash: "gemini_3_8_flash",
  grok_4_5: "grok_4_6",
  glm_5_2: "glm_5_3",
};

/** Developer for a target id (for the model picker + result chips). */
export const TARGET_DEVELOPER: Record<TargetModelId, Developer> = Object.fromEntries(
  TARGET_MODELS.map((m) => [m.id, m.developer]),
) as Record<TargetModelId, Developer>;

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
 * shows — routing may land on a knob model, and an out-of-ladder level is
 * advisory there, dropped by the route, never a 400).
 *
 * Verified against each vendor's API reference 2026-09-11; the wire parameter
 * per provider is documented on `providerEffort` in `providers/errors.ts`.
 */
export const TARGET_HAS_THINKING: Record<TargetModelId, boolean> = {
  fable_5_1: true,
  opus_5: true,
  sonnet_5: true,
  gpt_6_astra: true,
  gpt_5_6_sol: true,
  gpt_5_6_terra: true,
  gpt_5_6_luna: true,
  // deepseek-v4-pro: `reasoning_effort` low · high · max (thinking on by
  // default at high) — api-docs.deepseek.com/guides/thinking_mode.
  deepseek_v4: true,
  gemini_3_8_flash: true,
  muse_spark_1_1: false,
  minimax_m3: false,
  mistral_large_3: false,
  // kimi-k3: `reasoning_effort` low · high · max, DEFAULT max — which is why
  // an untuned Kimi run was the slowest thing in the fleet (platform.kimi.ai).
  kimi_k3: true,
  sonar_pro: false,
  qwen3_8_max: true,
  grok_4_6: true,
  // glm-5.3: `reasoning_effort` low · high · max, default max (docs.z.ai).
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

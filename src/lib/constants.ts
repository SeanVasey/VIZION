/** Shared, UI-facing constants for the VIZ(IO)N shell. */

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
  { id: "fable_5", label: "Fable 5", developer: "anthropic" },
  { id: "opus_5", label: "Opus 5", developer: "anthropic" },
  { id: "sonnet_5", label: "Sonnet 5", developer: "anthropic" },
  { id: "gpt_5_6_sol", label: "GPT-5.6 Sol", developer: "openai" },
  { id: "gpt_5_6_luna", label: "GPT-5.6 Luna", developer: "openai" },
  { id: "gpt_5_6_terra", label: "GPT-5.6 Terra", developer: "openai" },
  { id: "deepseek_v4", label: "DeepSeek V4", developer: "deepseek" },
  { id: "gemini_3_6_flash", label: "Gemini 3.6 Flash", developer: "google" },
  { id: "muse_spark_1_1", label: "Muse Spark 1.1", developer: "meta" },
  { id: "minimax_m3", label: "MiniMax M3", developer: "minimax" },
  { id: "mistral_large_3", label: "Mistral Large 3", developer: "mistral" },
  { id: "kimi_k3", label: "Kimi K3", developer: "moonshot" },
  { id: "sonar_pro", label: "Sonar Pro", developer: "perplexity" },
  { id: "qwen3_7_max", label: "Qwen3.7 Max", developer: "qwen" },
  { id: "grok_4_5", label: "Grok 4.5", developer: "xai" },
  { id: "glm_5_2", label: "GLM-5.2", developer: "zai" },
] as const satisfies readonly { id: string; label: string; developer: Developer }[];
export type TargetModelId = (typeof TARGET_MODELS)[number]["id"];

/** Every id this roster has ever renamed away from, mapped to its replacement.
 *  One entry per `ALTER TYPE model_target RENAME VALUE` in supabase/migrations —
 *  `tests/unit/model-target-enum.test.ts` pins that correspondence, because a
 *  rename with no entry here leaves a stale persisted selection that 400s on
 *  `/api/enhance`. Order is migration order, oldest first. */
export const LEGACY_TARGET_IDS: Record<string, TargetModelId> = {
  gpt_5_5: "gpt_5_6_sol",
  // Renamed twice (gemini_pro_3_1 → gemini_3_5_thinking → gemini_3_6_flash).
  // Every link in a rename chain points at the CURRENT id, not the next hop —
  // a value that is no longer a live target fails the enum contract test.
  gemini_pro_3_1: "gemini_3_6_flash",
  opus_4_8: "opus_5",
  llama_4_maverick: "muse_spark_1_1",
  minimax_m2_7: "minimax_m3",
  kimi_k2_6: "kimi_k3",
  gemini_3_5_thinking: "gemini_3_6_flash",
};

/** Developer for a target id (for the model picker + result chips). */
export const TARGET_DEVELOPER: Record<TargetModelId, Developer> = Object.fromEntries(
  TARGET_MODELS.map((m) => [m.id, m.developer]),
) as Record<TargetModelId, Developer>;

/** The reasoning-depth ladder, weakest first. A single app-wide vocabulary:
 *  each provider's API accepts a subset of it under its own parameter
 *  (Anthropic `output_config.effort` · OpenAI/xAI `reasoning_effort` ·
 *  Gemini `generationConfig.thinkingConfig.thinkingLevel`). */
export const THINKING_LEVELS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const THINKING_LEVEL_LABEL: Record<ThinkingLevel, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

/** Per-target thinking levels, exactly as each provider's API accepts them —
 *  a vendor app's picker names (Gemini "Thinking"/"Fast", ChatGPT "Ultra"…)
 *  are NOT API values; only what's listed here goes on the wire. A target
 *  with no entry has no per-request knob, so the composer shows no selector;
 *  leaving the selector on "Auto" sends nothing and the provider's own
 *  default applies. The OpenAI/xAI trio is the set their SDK types accept. */
export const TARGET_THINKING_LEVELS: Partial<
  Record<TargetModelId, readonly ThinkingLevel[]>
> = {
  fable_5: ["low", "medium", "high", "xhigh", "max"],
  opus_5: ["low", "medium", "high", "xhigh", "max"],
  sonnet_5: ["low", "medium", "high", "xhigh", "max"],
  gpt_5_6_sol: ["low", "medium", "high"],
  gpt_5_6_luna: ["low", "medium", "high"],
  gpt_5_6_terra: ["low", "medium", "high"],
  gemini_3_6_flash: ["minimal", "low", "medium", "high"],
  grok_4_5: ["low", "medium", "high"],
};

/** localStorage key for the UI store. Local cache is convenience only —
 *  the server is the source of truth for anything that matters. */
export const UI_STORE_KEY = "vizion.ui.v1";

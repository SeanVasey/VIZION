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
  { id: "target", label: "Target" },
] as const;
export type ModeId = (typeof MODES)[number]["id"];

/** Model developers, in locked display order: Anthropic and OpenAI always
 *  first, the rest alphabetical. `DEVELOPER_ORDER` is the single source the
 *  roster (and its ordering test) is checked against. */
export const DEVELOPER_ORDER = ["anthropic", "openai", "google", "mistral", "xai"] as const;
export type Developer = (typeof DEVELOPER_ORDER)[number];

export const DEVELOPER_LABEL: Record<Developer, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  mistral: "Mistral",
  xai: "xAI",
};

/** The target models (product-spec §4.3, extended). Strings are display
 *  labels; provider model strings live server-side so they can be swapped
 *  freely. IDs are also the DB `model_target` enum values — renaming one
 *  requires a migration (see supabase/migrations). Array order IS display
 *  order everywhere: grouped by developer (per DEVELOPER_ORDER), best model
 *  first within each developer. */
export const TARGET_MODELS = [
  { id: "fable_5", label: "Fable 5", developer: "anthropic" },
  { id: "opus_4_8", label: "Opus 4.8", developer: "anthropic" },
  { id: "gpt_5_6_sol", label: "GPT-5.6 Sol", developer: "openai" },
  { id: "gemini_3_5_thinking", label: "Gemini 3.5 Thinking", developer: "google" },
  { id: "grok_4_5", label: "Grok 4.5", developer: "xai" },
] as const satisfies readonly { id: string; label: string; developer: Developer }[];
export type TargetModelId = (typeof TARGET_MODELS)[number]["id"];

/** Developer for a target id (for the model picker + result chips). */
export const TARGET_DEVELOPER: Record<TargetModelId, Developer> = Object.fromEntries(
  TARGET_MODELS.map((m) => [m.id, m.developer]),
) as Record<TargetModelId, Developer>;

/** localStorage key for the UI store. Local cache is convenience only —
 *  the server is the source of truth for anything that matters. */
export const UI_STORE_KEY = "vizion.ui.v1";

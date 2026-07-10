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

/** The five target models (product-spec §4.3, extended). Strings are display
 *  labels; provider model strings live server-side so they can be swapped
 *  freely. IDs are also the DB `model_target` enum values — renaming one
 *  requires a migration (see supabase/migrations). */
export const TARGET_MODELS = [
  { id: "opus_4_8", label: "Opus 4.8" },
  { id: "gpt_5_6_sol", label: "GPT-5.6 Sol" },
  { id: "fable_5", label: "Fable 5" },
  { id: "gemini_3_5_thinking", label: "Gemini 3.5 Thinking" },
  { id: "grok_4_5", label: "Grok 4.5" },
] as const;
export type TargetModelId = (typeof TARGET_MODELS)[number]["id"];

/** localStorage key for the UI store. Local cache is convenience only —
 *  the server is the source of truth for anything that matters. */
export const UI_STORE_KEY = "vizion.ui.v1";

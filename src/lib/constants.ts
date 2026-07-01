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

/** The three target models (product-spec §4.3). Strings are display labels;
 *  provider model strings live server-side so they can be swapped freely. */
export const TARGET_MODELS = [
  { id: "opus_4_8", label: "Opus 4.8" },
  { id: "gpt_5_5", label: "GPT-5.5" },
  { id: "gemini_pro_3_1", label: "Gemini Pro 3.1" },
] as const;
export type TargetModelId = (typeof TARGET_MODELS)[number]["id"];

/** localStorage key for the UI store. Local cache is convenience only —
 *  the server is the source of truth for anything that matters. */
export const UI_STORE_KEY = "vizion.ui.v1";

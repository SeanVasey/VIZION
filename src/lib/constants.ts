/** Shared, UI-facing constants for the VIZ(IO)N shell. */

export const THEMES = ["dark", "light", "system"] as const;
export type Theme = (typeof THEMES)[number];

/** The five enhancement modes (product-spec §4.1). */
export const MODES = [
  { id: "clarify", label: "Clarify" },
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

/**
 * Footer monograms (R7).  Sean's real VM + V/AI monogram files are not yet in
 * the repo (only the VIZION mark/icon tokens are).  Until vm-monogram.svg and
 * vai-monogram.svg land in /public/brand, the footer shows a typographic
 * fallback.  Flip this to true once the real files exist — no code change
 * needed elsewhere.  Never redraw or approximate the monograms.
 */
export const BRAND_MONOGRAMS_READY = false;

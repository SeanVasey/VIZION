/**
 * Syntax segmentation for a generated prompt.
 *
 * A wall of undifferentiated monospace hides the parts that actually matter —
 * the engine flags you might want to edit, the hex codes you might want to
 * check. This splits the prompt into typed tokens; the component decides how
 * each one looks. Pure and total: every character of the input appears in
 * exactly one segment, so highlighting can never drop or reorder prompt text.
 *
 * Three grammars, matching the three shapes buildGenerationPrompt emits:
 *   midjourney  `… --ar 16:9 --v 6`, `palette #0a1e28 #3fd4e8`
 *   motion      `[runway] Subject: … Camera & motion: … Palette: #…, #…`
 *   audio       `Mood: …. Duration: ~30s.`
 */

import { GEN_TARGETS } from "./types";

export type PromptTokenKind =
  | "text"
  /** An engine flag and its value (`--ar 16:9`). */
  | "flag"
  /** A field label in the motion/audio grammars (`Subject:`). */
  | "label"
  /** The bracketed engine tag (`[runway]`). */
  | "engine"
  /** A `#rrggbb` colour — rendered with a swatch. */
  | "hex";

export interface PromptToken {
  kind: PromptTokenKind;
  text: string;
}

/** `--ar 16:9`, `--v 6`, and any future `--flag value` pair. */
const FLAG = /--[a-z]+(?:\s+[^\s]+)?/g;
/** Six-digit hex colours as emitted by quantizePalette. */
const HEX = /#[0-9a-fA-F]{6}\b/g;
/** Field labels the motion + audio grammars emit, anchored to their colon. */
const LABEL = /(?:Subject|Camera & motion|Lighting|Style|Mood|Palette|Duration):/g;
/**
 * The leading `[engine]` tag — anchored to the REAL engine ids, never "any
 * bracketed word".
 *
 * Only the motion grammar prepends a tag; the midjourney and audio grammars
 * start with the user's own base prompt, and a base prompt may legitimately
 * open with a bracket. `[intro]`, `[verse]` and `[chorus]` are the standard
 * structural syntax for audio generators — exactly the prompts the audio
 * target exists to build — and `[lofi]` is an ordinary style tag. Matching a
 * bare `[a-z]+` would silently delete the user's first word.
 */
const MOTION_ENGINES = GEN_TARGETS.filter((t) => t.kind === "video").map((t) => t.id);
const ENGINE = new RegExp(`^\\[(?:${MOTION_ENGINES.join("|")})\\]`, "g");

/** One matcher per token kind, in precedence order. */
const MATCHERS: { kind: Exclude<PromptTokenKind, "text">; re: RegExp }[] = [
  { kind: "engine", re: ENGINE },
  { kind: "flag", re: FLAG },
  { kind: "label", re: LABEL },
  { kind: "hex", re: HEX },
];

/**
 * Split `text` into typed tokens. Overlaps resolve by precedence then by
 * position; everything unmatched stays plain `text`, so joining every
 * segment's text reproduces the input exactly.
 */
export function highlightGenerationPrompt(text: string): PromptToken[] {
  if (text === "") return [];

  // Collect non-overlapping spans, earliest first, higher precedence winning.
  const spans: { start: number; end: number; kind: PromptTokenKind }[] = [];
  const taken = (start: number, end: number) =>
    spans.some((s) => start < s.end && end > s.start);

  for (const { kind, re } of MATCHERS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (!taken(start, end)) spans.push({ start, end, kind });
    }
  }
  spans.sort((a, b) => a.start - b.start);

  const tokens: PromptToken[] = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start > cursor) {
      tokens.push({ kind: "text", text: text.slice(cursor, s.start) });
    }
    tokens.push({ kind: s.kind, text: text.slice(s.start, s.end) });
    cursor = s.end;
  }
  if (cursor < text.length) {
    tokens.push({ kind: "text", text: text.slice(cursor) });
  }
  return tokens;
}

/**
 * The prompt with every piece of destination-specific syntax removed — the
 * "Plain" copy, for chat boxes that treat `--ar` (or a leading `[runway]`) as
 * literal text rather than as instructions to the engine.
 *
 * Both grammars that emit such syntax are handled: Midjourney's `--flag value`
 * pairs and the motion engines' bracketed tag. Stripping only the flags would
 * make Plain a byte-identical duplicate of Copy for Runway/Sora/Kling, whose
 * prompts carry no flags at all — a control that appears to do something and
 * doesn't. Hex codes and field labels stay: those are content.
 *
 * The gap left behind is closed with HORIZONTAL whitespace only. The base
 * prompt is user text — the attachment tray joins inserts with a blank line —
 * so collapsing `\s` would flatten real paragraph breaks and make Plain
 * disagree with Copy about the prompt's structure, not just its syntax.
 */
export function stripEngineSyntax(text: string): string {
  return text
    .replace(ENGINE, "")
    .replace(FLAG, "")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();
}

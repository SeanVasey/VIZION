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
/** The leading `[engine]` tag. */
const ENGINE = /^\[[a-z]+\]/g;

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

/** The prompt with every engine flag removed — "Plain" copy, for engines and
 *  chat boxes that treat `--ar` as literal text rather than a parameter. */
export function stripFlags(text: string): string {
  return text.replace(FLAG, "").replace(/\s{2,}/g, " ").trim();
}

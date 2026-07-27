import { describe, expect, it } from "vitest";
import {
  highlightGenerationPrompt,
  stripEngineSyntax,
  type PromptToken,
} from "@/lib/media/highlight";

const join = (tokens: PromptToken[]) => tokens.map((t) => t.text).join("");
const kinds = (tokens: PromptToken[], kind: string) =>
  tokens.filter((t) => t.kind === kind).map((t) => t.text);

const MIDJOURNEY =
  "epic scene, a lighthouse, wide shot, golden hour lighting, palette #0f1012 #b7ff3c --ar 16:9 --v 6";
const MOTION =
  "[runway] Subject: a lighthouse. Camera & motion: wide shot. Lighting: golden hour. Palette: #0f1012, #b7ff3c.";
const AUDIO = "score Mood: tense. Duration: ~30s.";

describe("highlightGenerationPrompt — totality", () => {
  it.each([MIDJOURNEY, MOTION, AUDIO, "", "plain words only"])(
    "reproduces its input exactly: %s",
    (input) => {
      // The load-bearing invariant: highlighting is presentation, so it must
      // never drop, duplicate, or reorder a single character of the prompt.
      expect(join(highlightGenerationPrompt(input))).toBe(input);
    },
  );

  it("emits tokens in source order", () => {
    const tokens = highlightGenerationPrompt(MOTION);
    let seen = 0;
    for (const t of tokens) {
      const at = MOTION.indexOf(t.text, seen);
      expect(at).toBeGreaterThanOrEqual(seen);
      seen = at + t.text.length;
    }
  });
});

describe("midjourney grammar", () => {
  const tokens = highlightGenerationPrompt(MIDJOURNEY);

  it("picks out the engine flags with their values", () => {
    expect(kinds(tokens, "flag")).toEqual(["--ar 16:9", "--v 6"]);
  });

  it("picks out every hex colour", () => {
    expect(kinds(tokens, "hex")).toEqual(["#0f1012", "#b7ff3c"]);
  });

  it("leaves the description as plain text", () => {
    expect(kinds(tokens, "text").join("")).toContain("a lighthouse");
  });
});

describe("motion grammar", () => {
  const tokens = highlightGenerationPrompt(MOTION);

  it("picks out the bracketed engine tag", () => {
    expect(kinds(tokens, "engine")).toEqual(["[runway]"]);
  });

  it("picks out the field labels, including the ampersand one", () => {
    expect(kinds(tokens, "label")).toEqual([
      "Subject:",
      "Camera & motion:",
      "Lighting:",
      "Palette:",
    ]);
  });

  it("does not mistake a mid-sentence colon for a label", () => {
    const tokens = highlightGenerationPrompt("a sign reading Note: hello");
    expect(kinds(tokens, "label")).toEqual([]);
  });
});

describe("audio grammar", () => {
  it("picks out its two labels and nothing else", () => {
    const tokens = highlightGenerationPrompt(AUDIO);
    expect(kinds(tokens, "label")).toEqual(["Mood:", "Duration:"]);
    expect(kinds(tokens, "flag")).toEqual([]);
  });
});

describe("stripEngineSyntax", () => {
  it("removes engine parameters for pasting into a chat box", () => {
    expect(stripEngineSyntax(MIDJOURNEY)).toBe(
      "epic scene, a lighthouse, wide shot, golden hour lighting, palette #0f1012 #b7ff3c",
    );
  });

  it("removes the bracketed engine tag the motion grammar emits", () => {
    expect(stripEngineSyntax(MOTION)).toBe(
      "Subject: a lighthouse. Camera & motion: wide shot. Lighting: golden hour. Palette: #0f1012, #b7ff3c.",
    );
  });

  it.each(["runway", "sora", "kling"])(
    "actually changes the %s prompt — Plain must not duplicate Copy",
    (engine) => {
      // The whole point of the Plain segment is to differ. A motion prompt
      // carries no flags, so a flags-only strip would return it verbatim and
      // the control would silently do nothing for three of five engines.
      const prompt = `[${engine}] Subject: a lighthouse.`;
      expect(stripEngineSyntax(prompt)).not.toBe(prompt);
      expect(stripEngineSyntax(prompt)).toBe("Subject: a lighthouse.");
    },
  );

  it("leaves a prompt without engine syntax untouched", () => {
    // The audio grammar emits neither a tag nor flags. Plain is therefore a
    // no-op here — which is why GenerateSheet hides the segment rather than
    // offering a button that copies exactly what Copy copies.
    expect(stripEngineSyntax(AUDIO)).toBe(AUDIO);
  });

  it("only strips a bracket at the start, not one inside the description", () => {
    expect(stripEngineSyntax("a sign reading [exit] ahead")).toBe(
      "a sign reading [exit] ahead",
    );
  });

  it.each([
    ["[intro] warm tape loop Mood: calm.", "an audio structure tag"],
    ["[verse] a rising line Mood: bright.", "another audio structure tag"],
    ["[lofi] neon alley --ar 16:9 --v 6", "a style tag on a midjourney prompt"],
  ])("keeps %s — a leading bracket is only syntax if it names a real engine", (input) => {
    // The midjourney and audio grammars begin with the USER's base prompt, so
    // "any bracketed word" would delete their first word. Only runway/sora/
    // kling actually prepend a tag.
    expect(stripEngineSyntax(input)).toContain(input.slice(0, input.indexOf("]") + 1));
  });

  it("preserves paragraph breaks — Plain differs from Copy in syntax, not shape", () => {
    // The attachment tray joins an inserted description onto the draft with a
    // blank line, so a multi-paragraph base prompt is a path the app itself
    // creates. Flattening it would make Plain disagree about the content.
    expect(stripEngineSyntax("A cyberpunk street.\n\nNeon signs. --ar 16:9 --v 6")).toBe(
      "A cyberpunk street.\n\nNeon signs.",
    );
  });

  it("still closes the horizontal gap a removed flag leaves behind", () => {
    expect(stripEngineSyntax("a lighthouse --ar 16:9 at dusk")).toBe(
      "a lighthouse at dusk",
    );
  });

  it("keeps hex codes and field labels, which are content and not parameters", () => {
    expect(stripEngineSyntax(MIDJOURNEY)).toContain("#b7ff3c");
    expect(stripEngineSyntax(MOTION)).toContain("Subject:");
  });
});

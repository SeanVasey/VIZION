import { describe, expect, it } from "vitest";
import {
  highlightGenerationPrompt,
  stripFlags,
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

describe("stripFlags", () => {
  it("removes engine parameters for pasting into a chat box", () => {
    expect(stripFlags(MIDJOURNEY)).toBe(
      "epic scene, a lighthouse, wide shot, golden hour lighting, palette #0f1012 #b7ff3c",
    );
  });

  it("leaves a prompt without flags untouched", () => {
    expect(stripFlags(AUDIO)).toBe(AUDIO);
  });

  it("keeps hex codes, which are content and not parameters", () => {
    expect(stripFlags(MIDJOURNEY)).toContain("#b7ff3c");
  });
});

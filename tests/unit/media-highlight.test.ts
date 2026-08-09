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
  it("removes the parameters midjourney appends", () => {
    expect(stripEngineSyntax(MIDJOURNEY, "midjourney")).toBe(
      "epic scene, a lighthouse, wide shot, golden hour lighting, palette #0f1012 #b7ff3c",
    );
  });

  it("removes the bracketed engine tag the motion grammar emits", () => {
    expect(stripEngineSyntax(MOTION, "runway")).toBe(
      "Subject: a lighthouse. Camera & motion: wide shot. Lighting: golden hour. Palette: #0f1012, #b7ff3c.",
    );
  });

  it.each(["runway", "sora", "kling"] as const)(
    "actually changes the %s prompt — Plain must not duplicate Copy",
    (engine) => {
      // The whole point of the Plain segment is to differ. A motion prompt
      // carries no flags, so a flags-only strip would return it verbatim and
      // the control would silently do nothing for three of five engines.
      const prompt = `[${engine}] Subject: a lighthouse.`;
      expect(stripEngineSyntax(prompt, engine)).toBe("Subject: a lighthouse.");
    },
  );

  it("strips only the selected engine's tag, never another engine's", () => {
    expect(stripEngineSyntax("[sora] Subject: x.", "runway")).toBe("[sora] Subject: x.");
  });

  it("leaves the audio spec alone — it carries no engine syntax", () => {
    // Which is why GenerateSheet hides the segment for this engine rather
    // than offering a no-op button.
    expect(stripEngineSyntax(AUDIO, "audio")).toBe(AUDIO);
  });
});

describe("stripEngineSyntax — the base prompt is user text, not syntax", () => {
  it("keeps a --flag the USER wrote in the middle of their prompt", () => {
    // `Explain the --help option` is an ordinary thing to want enhanced. A
    // pattern sweep over the whole string deleted it (and the comma after
    // it); anchoring to the suffix the formatter actually appended does not.
    expect(
      stripEngineSyntax(
        "Explain the --help option, a lighthouse --ar 16:9 --v 6",
        "midjourney",
      ),
    ).toBe("Explain the --help option, a lighthouse");
  });

  it("cannot invent a Plain variant out of user text on a flagless engine", () => {
    // On audio and motion the formatter appends no flags, so a user's own
    // `--flag` must not make Plain differ from Copy — that would surface the
    // segment purely to mangle their prompt.
    const audio = "Explain the --help option Mood: calm. Duration: ~30s.";
    expect(stripEngineSyntax(audio, "audio")).toBe(audio);
    const motion = "[runway] Subject: the --help option.";
    expect(stripEngineSyntax(motion, "runway")).toBe("Subject: the --help option.");
  });

  it.each([
    ["[intro] warm tape loop Mood: calm.", "audio"],
    ["[lofi] neon alley --ar 16:9 --v 6", "midjourney"],
  ] as const)("keeps a leading bracket the user wrote (%s)", (input, engine) => {
    // `[intro]`/`[verse]`/`[chorus]` are standard audio-generator syntax and
    // `[lofi]` an ordinary style tag — content, not something to strip.
    expect(stripEngineSyntax(input, engine)).toContain(
      input.slice(0, input.indexOf("]") + 1),
    );
  });

  it("preserves paragraph breaks — nothing is ever cut from the middle", () => {
    // The attachment tray joins an inserted description onto the draft with a
    // blank line, so multi-paragraph bases are a path the app itself creates.
    expect(
      stripEngineSyntax(
        "A cyberpunk street.\n\nNeon signs. --ar 16:9 --v 6",
        "midjourney",
      ),
    ).toBe("A cyberpunk street.\n\nNeon signs.");
  });

  it("returns empty when midjourney had nothing but its parameters", () => {
    // GenerateSheet treats empty as "no Plain variant", so the segment hides
    // rather than copying nothing.
    expect(stripEngineSyntax("--ar 16:9 --v 6", "midjourney")).toBe("");
  });
});

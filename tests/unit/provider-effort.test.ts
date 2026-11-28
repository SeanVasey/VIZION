import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TARGET_MODELS,
  THINKING_LADDER,
  THINKING_LEVELS,
  type TargetModelId,
} from "@/lib/constants";
import { TARGETS } from "@/lib/providers/config";
import {
  describeProviderFailure,
  hasDistinctMedium,
  isDeepEffort,
  providerEffort,
  type EffortVocabulary,
} from "@/lib/providers/errors";
import { buildMistralParams, mistralText } from "@/lib/providers/mistral";
import { buildOpenAIParams } from "@/lib/providers/openai";
import { buildXAIParams } from "@/lib/providers/xai";

/**
 * The one translation table from the app's ladder onto every API's
 * reasoning vocabulary (ADR-0018). Two properties are load-bearing and both
 * are pinned for EVERY vocabulary rather than spot-checked: the mapping is
 * monotone (a higher stop never sends a lower provider value), and the ends
 * are honest — Low is the provider's cheapest word, Max its costliest — so
 * the peak caption's "highest cost" is never a lie on a three-valued API.
 */
const VOCABULARIES: EffortVocabulary[] = [
  "five",
  "openai",
  "toXhigh",
  "toHigh",
  "three",
  "threeX",
];

/** Each vocabulary's words, cheapest first — the order the vendors' own docs
 *  list them in. A vocabulary is a SHAPE (errors.ts): who uses it is
 *  config.ts's business, pinned separately below. */
const RANK: Record<EffortVocabulary, string[]> = {
  five: ["low", "medium", "high", "xhigh", "max"],
  openai: ["low", "medium", "high", "xhigh", "max"],
  toXhigh: ["low", "medium", "high", "xhigh"],
  toHigh: ["low", "medium", "high"],
  three: ["low", "high", "max"],
  threeX: ["low", "high", "xhigh"],
};

describe("providerEffort", () => {
  it("sends nothing for Auto", () => {
    for (const v of VOCABULARIES) expect(providerEffort(v, undefined)).toBeUndefined();
  });

  it.each(VOCABULARIES)("%s: only ever emits a word the provider accepts", (v) => {
    for (const level of THINKING_LEVELS) {
      expect(RANK[v], `${v}/${level}`).toContain(providerEffort(v, level));
    }
  });

  it.each(VOCABULARIES)("%s: is monotone up the ladder", (v) => {
    let last = -1;
    for (const level of THINKING_LADDER) {
      const rank = RANK[v].indexOf(providerEffort(v, level)!);
      expect(rank, `${v}/${level}`).toBeGreaterThanOrEqual(last);
      last = rank;
    }
  });

  it.each(VOCABULARIES)(
    "%s: keeps the ends honest — Low cheapest, Max costliest",
    (v) => {
      expect(providerEffort(v, "low")).toBe(RANK[v][0]);
      expect(providerEffort(v, "max")).toBe(RANK[v][RANK[v].length - 1]);
    },
  );

  it("pins the collapses", () => {
    // Three-valued APIs (DeepSeek, Kimi, GLM; Qwen4): Medium lands on the
    // middle word, which is their `high`.
    expect(providerEffort("three", "medium")).toBe("high");
    expect(providerEffort("threeX", "medium")).toBe("high");
    // Qwen4-Max's top word is xhigh, not max.
    expect(providerEffort("threeX", "max")).toBe("xhigh");
    // Gemini 4 Carbon, Mistral Large 4: no xhigh, no minimal.
    expect(providerEffort("toHigh", "max")).toBe("high");
    expect(providerEffort("toHigh", "minimal")).toBe("low");
    // Grok 4.7, Gemini 4 Neon and Hydrogen: xhigh is the top.
    expect(providerEffort("toXhigh", "max")).toBe("xhigh");
    // Where xhigh is a real tier a legacy xhigh rides through rather than
    // folding onto high.
    expect(providerEffort("five", "xhigh")).toBe("xhigh");
    expect(providerEffort("openai", "xhigh")).toBe("xhigh");
    expect(providerEffort("toXhigh", "xhigh")).toBe("xhigh");
  });

  it("knows which vocabularies have a Medium of their own", () => {
    // What Auto reads to pick its moderate stop: on a three-valued API
    // Medium is only a second name for High.
    expect(hasDistinctMedium("five")).toBe(true);
    expect(hasDistinctMedium("openai")).toBe(true);
    expect(hasDistinctMedium("toXhigh")).toBe(true);
    expect(hasDistinctMedium("toHigh")).toBe(true);
    expect(hasDistinctMedium("three")).toBe(false);
    expect(hasDistinctMedium("threeX")).toBe(false);
  });
});

describe("the roster's vocabularies (config.ts)", () => {
  it("never sends a model a word its API rejects — every target, every level", () => {
    // The property that matters end to end: for each roster model, each
    // level the dial can produce translates to a word in that model's own
    // documented set. RANK is the set per shape; config.ts assigns the shape.
    for (const m of TARGET_MODELS) {
      const vocabulary = TARGETS[m.id].effort;
      if (!vocabulary) continue;
      for (const level of THINKING_LEVELS) {
        expect(RANK[vocabulary], `${m.id}/${level}`).toContain(
          providerEffort(vocabulary, level),
        );
      }
    }
  });

  it("pins each vendor's shape to what its docs listed on 2026-11-28", () => {
    const shapeOf = (id: TargetModelId) => TARGETS[id].effort;
    for (const id of ["fable_5_2", "opus_5_5", "sonnet_5_5", "haiku_5_5"] as const)
      expect(shapeOf(id), id).toBe("five");
    for (const id of [
      "gpt_6_2_astra",
      "gpt_6_2_sol",
      "gpt_6_1_terra",
      "gpt_6_luna",
    ] as const)
      expect(shapeOf(id), id).toBe("openai");
    // low · medium · high · xhigh
    for (const id of ["grok_4_7", "gemini_4_neon", "gemini_4_hydrogen"] as const)
      expect(shapeOf(id), id).toBe("toXhigh");
    // low · medium · high — Max must land on `high`, their top
    for (const id of ["gemini_4_carbon", "mistral_large_4"] as const)
      expect(shapeOf(id), id).toBe("toHigh");
    // low · high · max
    for (const id of ["deepseek_v4", "kimi_k3_1_pro", "glm_5_3"] as const)
      expect(shapeOf(id), id).toBe("three");
    // low · high · xhigh
    expect(shapeOf("qwen4_max")).toBe("threeX");
    // minimal/low … max
    for (const id of ["muse_wonder_1_0", "muse_spark_1_3", "minimax_m3_1_flash"] as const)
      expect(shapeOf(id), id).toBe("five");
    expect(shapeOf("sonar_pro")).toBeUndefined();
  });
});

describe("isDeepEffort", () => {
  it("is the two top ladder stops (and the legacy xhigh), nothing else", () => {
    expect(isDeepEffort(undefined)).toBe(false);
    expect(isDeepEffort("minimal")).toBe(false);
    expect(isDeepEffort("low")).toBe(false);
    expect(isDeepEffort("medium")).toBe(false);
    expect(isDeepEffort("high")).toBe(true);
    expect(isDeepEffort("xhigh")).toBe(true);
    expect(isDeepEffort("max")).toBe(true);
  });
});

describe("first-party request builders carry the translated word", () => {
  it("OpenAI: max and xhigh ride the wire, and the deep tier gets headroom", () => {
    expect(buildOpenAIParams("gpt-6.2-astra", "s", "i", "max").reasoning_effort).toBe(
      "max",
    );
    expect(buildOpenAIParams("gpt-6.2-sol", "s", "i", "max").max_completion_tokens).toBe(
      32_000,
    );
    expect(buildOpenAIParams("gpt-6.2-sol", "s", "i", "low").max_completion_tokens).toBe(
      16_000,
    );
    expect("reasoning_effort" in buildOpenAIParams("gpt-6.2-sol", "s", "i")).toBe(false);
  });

  it("OpenAI: never sends `none` — GPT-6.2 rejects it", () => {
    for (const level of THINKING_LEVELS) {
      expect(
        buildOpenAIParams("gpt-6.2-astra", "s", "i", level).reasoning_effort,
      ).not.toBe("none");
    }
  });

  it("xAI: Max lands on xhigh — Grok 4.7's top — with the deep headroom", () => {
    expect(buildXAIParams("grok-4.7", "s", "i", "max").reasoning_effort).toBe("xhigh");
    expect(buildXAIParams("grok-4.7", "s", "i", "max").max_tokens).toBe(32_000);
    expect(buildXAIParams("grok-4.7", "s", "i", "medium").max_tokens).toBe(16_000);
  });

  it("Mistral: Large 4 takes an effort word now, and Max lands on high", () => {
    // Large 3 had no knob and this adapter sent none. Large 4 always
    // reasons: low · medium · high, and it does not accept xhigh or max.
    const max = buildMistralParams("mistral-large-4-0", "s", "i", "max");
    expect(max.reasoning_effort).toBe("high");
    expect(max.max_tokens).toBe(32_000);
    const low = buildMistralParams("mistral-large-4-0", "s", "i", "low");
    expect(low.reasoning_effort).toBe("low");
    expect(low.max_tokens).toBe(16_000);
    // No level resolved = no field at all (Mistral 422s on unknown fields,
    // and a non-reasoning model behind MODEL_MISTRAL must not be sent one).
    expect("reasoning_effort" in buildMistralParams("m", "s", "i")).toBe(false);
    expect("stream_options" in max).toBe(false);
  });

  it("Mistral: reads answer text out of a typed-chunk delta, dropping thinking", () => {
    expect(mistralText("plain")).toBe("plain");
    expect(
      mistralText([
        { type: "thinking", thinking: [{ type: "text", text: "hmm" }] },
        { type: "text", text: '{"output":' },
        { type: "text", text: ' "x"}' },
      ]),
    ).toBe('{"output": "x"}');
    expect(mistralText(null)).toBe("");
    expect(mistralText(undefined)).toBe("");
  });
});

describe("describeProviderFailure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("names the key and the env var on a 401/403 — the 'no body' screenshot", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const msg = describeProviderFailure(
      "mistral",
      "Mistral",
      "MISTRAL_API_KEY",
      401,
      "401 status code (no body)",
    );
    expect(msg).toContain("Mistral request failed: 401 status code (no body)");
    expect(msg).toContain("MISTRAL_API_KEY");
    expect(msg).toMatch(/refused the server's API key/);
    expect(console.warn).toHaveBeenCalledWith(
      "[mistral] upstream error",
      401,
      expect.any(String),
    );
  });

  it("points a 404 at the MODEL_* override, not the key", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const msg = describeProviderFailure(
      "zai",
      "GLM",
      "ZAI_API_KEY",
      404,
      "model not found",
    );
    expect(msg).toContain("MODEL_*");
    expect(msg).not.toContain("refused the server's API key");
  });

  it("relays every other status bare", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(describeProviderFailure("openai", "GPT", "OPENAI_API_KEY", 500, "boom")).toBe(
      "GPT request failed: boom",
    );
    expect(
      describeProviderFailure("openai", "GPT", "OPENAI_API_KEY", undefined, "boom"),
    ).toBe("GPT request failed: boom");
  });
});

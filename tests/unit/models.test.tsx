import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  LEGACY_TARGET_IDS,
  resolveTargetId,
  TARGET_MODELS,
  TARGET_DEVELOPER,
  TARGET_HAS_THINKING,
  THINKING_LADDER,
  THINKING_LEVELS,
  THINKING_LEVEL_LABEL,
  DEVELOPER_ORDER,
  DEVELOPER_LABEL,
  normalizeThinkingLevel,
  type Developer,
} from "@/lib/constants";
import { DeveloperIcon } from "@/components/models/DeveloperIcon";
import { TARGETS } from "@/lib/providers/config";
import { TARGET_ROUTING } from "@/lib/providers/manifest";

describe("model roster ordering", () => {
  it("groups models by developer in the locked order (Anthropic, OpenAI, then alphabetical)", () => {
    // Developers must appear in DEVELOPER_ORDER, each as one contiguous group.
    const seen: Developer[] = TARGET_MODELS.map((m) => m.developer).filter(
      (d, i, arr) => i === 0 || arr[i - 1] !== d,
    );
    const expected = DEVELOPER_ORDER.filter((d) => seen.includes(d));
    expect(seen).toEqual(expected);
  });

  it("locks Anthropic and OpenAI first, then the rest alphabetically", () => {
    expect(DEVELOPER_ORDER.slice(0, 2)).toEqual(["anthropic", "openai"]);
    const rest = DEVELOPER_ORDER.slice(2);
    expect(rest).toEqual([...rest].sort());
  });

  it("puts the best Anthropic model first (Fable 5 before Opus 5.5 before Sonnet 5.5)", () => {
    const ids = TARGET_MODELS.map((m) => m.id);
    expect(ids.indexOf("fable_5_2")).toBeLessThan(ids.indexOf("opus_5_5"));
    expect(ids.indexOf("opus_5_5")).toBeLessThan(ids.indexOf("sonnet_5_5"));
    expect(ids[0]).toBe("fable_5_2");
  });

  it("maps every target id to its developer", () => {
    for (const m of TARGET_MODELS) {
      expect(TARGET_DEVELOPER[m.id]).toBe(m.developer);
      expect(DEVELOPER_LABEL[m.developer]).toBeTruthy();
    }
  });

  it("puts the best OpenAI tier first (Astra, then Sol before Terra before Luna)", () => {
    // OpenAI's own tiering: GPT-6.2 Astra above the 5.6 family, then flagship
    // / balanced mid / small. The roster briefly had Terra and Luna swapped
    // — pinned so the picker's "best first within each developer" promise
    // stays true.
    const ids = TARGET_MODELS.map((m) => m.id);
    expect(ids.indexOf("gpt_6_2_astra")).toBeLessThan(ids.indexOf("gpt_6_2_sol"));
    expect(ids.indexOf("gpt_6_2_sol")).toBeLessThan(ids.indexOf("gpt_6_1_terra"));
    expect(ids.indexOf("gpt_6_1_terra")).toBeLessThan(ids.indexOf("gpt_6_luna"));
  });

  it("keeps the client-safe developer field in sync with the server provider config", () => {
    // TARGETS (server) and TARGET_MODELS.developer (client) are separate
    // records by design — this pins them together so they can't drift.
    for (const m of TARGET_MODELS) {
      expect(TARGETS[m.id].provider).toBe(m.developer);
      expect(TARGETS[m.id].model).toBeTruthy();
      expect(TARGETS[m.id].priceIn).toBeGreaterThan(0);
      expect(TARGETS[m.id].priceOut).toBeGreaterThan(0);
    }
  });

  it("stamps every price row with a parseable verification date (META-01)", () => {
    // Presence + format only, deliberately NOT age: a test that starts
    // failing by calendar time breaks "ship-ready every commit". Staleness is
    // a runbook review item, not a build gate.
    for (const m of TARGET_MODELS) {
      const stamp = TARGETS[m.id].pricesVerifiedAt;
      expect(typeof stamp).toBe("string");
      expect(Number.isFinite(Date.parse(stamp))).toBe(true);
    }
  });

  it("gives every roster model routing facts with a sane strength", () => {
    // Belt-and-braces beside the Record type: the compiler catches a missing
    // entry, this catches a nonsense one (strength outside the documented
    // 1-10 editorial scale would silently warp every ladder).
    for (const m of TARGET_MODELS) {
      const facts = TARGET_ROUTING[m.id];
      expect(facts).toBeDefined();
      expect(Number.isInteger(facts.strength)).toBe(true);
      expect(facts.strength).toBeGreaterThanOrEqual(1);
      expect(facts.strength).toBeLessThanOrEqual(10);
    }
  });

  it("keeps every Gemini target on a real model string (no invented thinking ID)", () => {
    // Gemini has no separate thinking model ID — depth is a `thinkingLevel`
    // value on the one model string. Inventing a `gemini-…-thinking` string
    // 404s every call, and because 404 reads as a config error the media
    // route would silently fall back to another provider instead of
    // surfacing it. Gemini 4 names its tiers by element; the ids are the
    // vendor's own (aistudio.google.com/docs/models, 2026-11-28).
    expect(TARGETS.gemini_4_carbon.model).toBe("gemini-4-carbon");
    expect(TARGETS.gemini_4_neon.model).toBe("gemini-4-neon");
    expect(TARGETS.gemini_4_hydrogen.model).toBe("gemini-4-hydrogen");
    for (const id of ["gemini_4_carbon", "gemini_4_neon", "gemini_4_hydrogen"] as const)
      expect(TARGETS[id].model).not.toContain("thinking");
  });

  it("orders Gemini 4 best first — the element names do not sort themselves", () => {
    // Carbon > Neon > Hydrogen is Google's own positioning, and nothing in
    // the names says so (alphabetical and periodic order both get it wrong).
    const google = TARGET_MODELS.filter((m) => m.developer === "google").map((m) => m.id);
    expect(google).toEqual(["gemini_4_carbon", "gemini_4_neon", "gemini_4_hydrogen"]);
  });
});

describe("thinking levels", () => {
  it("offers ONE four-stop ladder, drawn in order from the wire vocabulary", () => {
    // ADR-0018: the dial is the same for every model. The ladder is a
    // strictly ascending subset of THINKING_LEVELS with Max at the top and
    // Low at the bottom, and every stop has a display label.
    expect([...THINKING_LADDER]).toEqual(["low", "medium", "high", "max"]);
    const positions = THINKING_LADDER.map((l) => THINKING_LEVELS.indexOf(l));
    expect(positions).not.toContain(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const l of THINKING_LADDER) expect(THINKING_LEVEL_LABEL[l]).toBeTruthy();
  });

  it("folds every wire level onto the ladder, monotonically", () => {
    // `minimal` (Gemini 3.6's old floor) and `xhigh` (Anthropic's second ultra
    // tier) are legacy stops: each lands on its ladder neighbour, and a
    // higher wire level never folds below a lower one.
    const ladderIndex = (l: (typeof THINKING_LADDER)[number]) =>
      THINKING_LADDER.indexOf(l);
    let last = -1;
    for (const level of THINKING_LEVELS) {
      const folded = ladderIndex(normalizeThinkingLevel(level));
      expect(folded).toBeGreaterThanOrEqual(last);
      last = folded;
    }
    expect(normalizeThinkingLevel("minimal")).toBe("low");
    expect(normalizeThinkingLevel("xhigh")).toBe("high");
    for (const l of THINKING_LADDER) expect(normalizeThinkingLevel(l)).toBe(l);
  });

  it("declares a thinking knob for exactly the targets whose API takes one", () => {
    // Total over the roster (the Record type enforces it); the VALUES are
    // pinned per the vendor references read 2026-11-28. One model is left
    // without a knob — Mistral, Meta and MiniMax each shipped one since the
    // 2026-09 pass.
    for (const m of TARGET_MODELS)
      expect(typeof TARGET_HAS_THINKING[m.id]).toBe("boolean");
    const knobless = TARGET_MODELS.map((m) => m.id).filter(
      (id) => !TARGET_HAS_THINKING[id],
    );
    expect(knobless).toEqual(["sonar_pro"]);
  });

  it("agrees with the server about WHICH targets have a knob", () => {
    // The same fact lives on both sides of the wire: the client's boolean
    // (does the rail show?) and the server's vocabulary (what does the
    // adapter send?). A target the dial offers but the adapter has no words
    // for would silently send nothing; the reverse would send an effort the
    // user was never shown.
    for (const m of TARGET_MODELS) {
      expect(TARGET_HAS_THINKING[m.id], m.id).toBe(TARGETS[m.id].effort !== undefined);
    }
  });

  it("gives each Gemini 4 model its OWN vocabulary — they do not share one", () => {
    // The reason the vocabulary is per target. Carbon stops at `high`; Neon
    // and Hydrogen add `xhigh`. One provider-wide table either 400s Carbon
    // or caps the other two a stop short.
    expect(TARGETS.gemini_4_carbon.effort).toBe("toHigh");
    expect(TARGETS.gemini_4_neon.effort).toBe("toXhigh");
    expect(TARGETS.gemini_4_hydrogen.effort).toBe("toXhigh");
  });

  it("keeps Qwen's model TIER out of its thinking ladder", () => {
    // "Max" in `Qwen4 Max` is Alibaba's flagship tier, not a reasoning
    // depth. Reading the tier as a thinking level is what once left this
    // target with no selector at all — the two are independent, and the
    // model string must carry no depth of its own.
    expect(TARGETS.qwen4_max.model).toBe("qwen4-max");
    expect(TARGETS.qwen4_max.model).not.toContain("thinking");
    expect(TARGET_HAS_THINKING.qwen4_max).toBe(true);
  });
});

describe("DeveloperIcon", () => {
  it.each(DEVELOPER_ORDER)("renders a currentColor mark for %s", (developer) => {
    const { container } = render(<DeveloperIcon developer={developer} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
    const path = svg!.querySelector("path");
    expect(path).not.toBeNull();
    // Theme green comes from the parent's text colour — never a hardcoded fill.
    expect(path!.getAttribute("fill")).toBe("currentColor");
    expect(path!.getAttribute("d")).toMatch(/^M/);
  });

  it("accepts a size/colour className", () => {
    const { container } = render(
      <DeveloperIcon developer="anthropic" className="h-3.5 w-3.5 text-accent" />,
    );
    expect(container.querySelector("svg")!.getAttribute("class")).toContain(
      "text-accent",
    );
  });

  it("keeps Meta's slot on the thesvg.org infinity mark", () => {
    // Pinned because this mark was once swapped for a hand-drawn glyph:
    // developer marks identify the developer, not the model in the slot.
    // Signature = the opening move + both inner counters of meta/mono.svg.
    const { container } = render(<DeveloperIcon developer="meta" />);
    const d = container.querySelector("path")!.getAttribute("d")!;
    expect(container.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(d.startsWith("M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113")).toBe(true);
    expect(d).toContain("zm10.16 2.053c1.147 0 2.188.758 2.992 1.999");
    expect(d).toContain("zm-10.201.553c1.265 0 2.058.791 2.675 1.446");
  });
});

describe("resolveTargetId", () => {
  it("passes a live id through and folds a retired one forward", () => {
    // A tab open across a roster deploy, or a save queued offline, presents
    // last roster's id. That is not a bad request.
    expect(resolveTargetId("opus_5_5")).toBe("opus_5_5");
    expect(resolveTargetId("opus_5")).toBe("opus_5_5");
    expect(resolveTargetId("gemini_3_8_flash")).toBe("gemini_4_hydrogen");
    // A chain resolves in ONE hop — every legacy entry points at a live id.
    expect(resolveTargetId("gemini_pro_3_1")).toBe("gemini_4_hydrogen");
    for (const [legacy, current] of Object.entries(LEGACY_TARGET_IDS)) {
      expect(resolveTargetId(legacy), legacy).toBe(current);
      expect(
        TARGET_MODELS.some((m) => m.id === current),
        legacy,
      ).toBe(true);
    }
  });

  it("refuses anything that was never a target — including object keys", () => {
    for (const bad of ["", "auto", "bogus", "constructor", "toString", "__proto__"])
      expect(resolveTargetId(bad), bad).toBeUndefined();
    for (const bad of [undefined, null, 5, {}, ["opus_5_5"]])
      expect(resolveTargetId(bad)).toBeUndefined();
  });
});

describe("strEnv", () => {
  it("treats a blank override as unset — a copied .env.example must not blank a model id", async () => {
    const { strEnv } = await import("@/lib/providers/config");
    const prev = process.env.VIZION_TEST_STR;
    try {
      delete process.env.VIZION_TEST_STR;
      expect(strEnv("VIZION_TEST_STR", "fallback")).toBe("fallback");
      process.env.VIZION_TEST_STR = "";
      expect(strEnv("VIZION_TEST_STR", "fallback")).toBe("fallback");
      process.env.VIZION_TEST_STR = "   ";
      expect(strEnv("VIZION_TEST_STR", "fallback")).toBe("fallback");
      process.env.VIZION_TEST_STR = "custom-model";
      expect(strEnv("VIZION_TEST_STR", "fallback")).toBe("custom-model");
    } finally {
      if (prev === undefined) delete process.env.VIZION_TEST_STR;
      else process.env.VIZION_TEST_STR = prev;
    }
  });

  it("gives every roster target a non-empty model id", () => {
    for (const m of TARGET_MODELS)
      expect(TARGETS[m.id].model.length, m.id).toBeGreaterThan(0);
  });
});

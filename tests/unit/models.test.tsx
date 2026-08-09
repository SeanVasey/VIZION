import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  TARGET_MODELS,
  TARGET_DEVELOPER,
  TARGET_THINKING_LEVELS,
  THINKING_LEVELS,
  THINKING_LEVEL_LABEL,
  DEVELOPER_ORDER,
  DEVELOPER_LABEL,
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

  it("puts the best Anthropic model first (Fable 5 before Opus 5 before Sonnet 5)", () => {
    const ids = TARGET_MODELS.map((m) => m.id);
    expect(ids.indexOf("fable_5")).toBeLessThan(ids.indexOf("opus_5"));
    expect(ids.indexOf("opus_5")).toBeLessThan(ids.indexOf("sonnet_5"));
    expect(ids[0]).toBe("fable_5");
  });

  it("maps every target id to its developer", () => {
    for (const m of TARGET_MODELS) {
      expect(TARGET_DEVELOPER[m.id]).toBe(m.developer);
      expect(DEVELOPER_LABEL[m.developer]).toBeTruthy();
    }
  });

  it("puts the best OpenAI tier first (Sol before Terra before Luna)", () => {
    // OpenAI's own tiering: flagship / balanced mid / small. The roster
    // briefly had Terra and Luna swapped — pinned so the picker's "best
    // first within each developer" promise stays true.
    const ids = TARGET_MODELS.map((m) => m.id);
    expect(ids.indexOf("gpt_5_6_sol")).toBeLessThan(ids.indexOf("gpt_5_6_terra"));
    expect(ids.indexOf("gpt_5_6_terra")).toBeLessThan(ids.indexOf("gpt_5_6_luna"));
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

  it("keeps the Gemini target on the real 3.6 model string (no invented thinking ID)", () => {
    // Gemini 3.x has no separate thinking model ID — "Thinking" and "Fast" in
    // the Gemini app are thinkingLevel values on `gemini-3.6-flash`. Inventing
    // a `gemini-3.6-thinking` string 404s every call, and because 404 reads as
    // a config error the media route would silently fall back to another
    // provider instead of surfacing it.
    expect(TARGETS.gemini_3_6_flash.model).toBe("gemini-3.6-flash");
    expect(TARGETS.gemini_3_6_flash.model).not.toContain("thinking");
  });
});

describe("thinking levels", () => {
  it("declares levels only for roster targets, drawn from the ordered ladder", () => {
    const rosterIds: string[] = TARGET_MODELS.map((m) => m.id);
    for (const [id, levels] of Object.entries(TARGET_THINKING_LEVELS)) {
      expect(rosterIds).toContain(id);
      expect(levels.length).toBeGreaterThan(0);
      const positions = levels.map((l) => THINKING_LEVELS.indexOf(l));
      // Every level exists in the ladder, appears once, in ladder order —
      // the composer renders the array verbatim as the selector.
      expect(positions).not.toContain(-1);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      expect(new Set(levels).size).toBe(levels.length);
      // Every offered level has a display label.
      for (const l of levels) expect(THINKING_LEVEL_LABEL[l]).toBeTruthy();
    }
  });

  it("pins each provider's ladder to the values its API accepts", () => {
    // Gemini thinkingConfig.thinkingLevel — exactly these four.
    expect(TARGET_THINKING_LEVELS.gemini_3_6_flash).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
    ]);
    // OpenAI/xAI reasoning_effort — the SDK-typed trio (toReasoningEffort
    // narrows to it, so anything wider would be silently dropped).
    for (const id of ["gpt_5_6_sol", "gpt_5_6_luna", "gpt_5_6_terra", "grok_4_5"] as const) {
      expect(TARGET_THINKING_LEVELS[id]).toEqual(["low", "medium", "high"]);
    }
    // Anthropic output_config.effort — the full five-step ladder.
    for (const id of ["fable_5", "opus_5", "sonnet_5"] as const) {
      expect(TARGET_THINKING_LEVELS[id]).toEqual(["low", "medium", "high", "xhigh", "max"]);
    }
    // DashScope enable_thinking + thinking_budget — a token budget, so the
    // whole ladder maps onto it (the per-step budgets live in the adapter).
    expect(TARGET_THINKING_LEVELS.qwen3_8_max).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  it("keeps Qwen's model TIER out of its thinking ladder", () => {
    // "Max" in `Qwen3.8 Max` is Alibaba's flagship tier (beside Plus and
    // Turbo), not a reasoning depth. Reading the tier as a thinking level is
    // what once left this target with no selector at all — the two are
    // independent, and the model string must carry no depth of its own.
    expect(TARGETS.qwen3_8_max.model).toBe("qwen3.8-max");
    expect(TARGETS.qwen3_8_max.model).not.toContain("thinking");
    expect(TARGET_THINKING_LEVELS.qwen3_8_max).toBeDefined();
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

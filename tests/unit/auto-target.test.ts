import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_LADDERS,
  LONG_INPUT_CHARS,
  defaultThinkingLevel,
  resolveAutoTarget,
  resolveAutoVisionTarget,
} from "@/lib/enhance/auto-target";
import {
  AUTO_PREFERENCES,
  MODES,
  TARGET_MODELS,
  type TargetModelId,
} from "@/lib/constants";
import { PROVIDER_KEY_ENV, TARGETS } from "@/lib/providers/config";
import { providerEffort } from "@/lib/providers/errors";
import { TARGET_ROUTING, blendedPrice } from "@/lib/providers/manifest";

const ROSTER = new Set<string>(TARGET_MODELS.map((m) => m.id));
/** Auto's pool: the roster minus opted-out specialists. */
const POOL = TARGET_MODELS.map((m) => m.id).filter(
  (id) => !TARGET_ROUTING[id].autoExcluded,
);
const ALL = () => true;
const CHAR_POINTS = [0, 10, LONG_INPUT_CHARS, LONG_INPUT_CHARS + 1, 500_000];

describe("resolveAutoTarget — totality", () => {
  it.each(MODES.map((m) => m.id))(
    "always resolves %s to a live roster id, for every preference",
    (mode) => {
      // Auto is a wire concept; whatever it resolves to gets written to the
      // model_target ENUM columns. A cell naming a retired id would be a
      // 22P02 at insert time, long after the run was paid for.
      for (const preference of AUTO_PREFERENCES) {
        for (const chars of CHAR_POINTS) {
          for (const media of [false, true]) {
            const route = resolveAutoTarget(mode, chars, media, preference, ALL);
            expect(ROSTER.has(route.target)).toBe(true);
            expect(route.target).not.toBe("auto");
          }
        }
      }
    },
  );

  it("every ladder is total over the pool — nothing dropped, nothing invented", () => {
    // Below-floor targets are APPENDED, never removed, so availability
    // filtering can never walk off the end of a non-empty pool.
    for (const preference of AUTO_PREFERENCES) {
      for (const tier of ["light", "heavy"] as const) {
        expect([...AUTO_LADDERS[preference][tier]].sort()).toEqual([...POOL].sort());
      }
    }
  });

  it("is deterministic — same inputs, same route", () => {
    for (const preference of AUTO_PREFERENCES) {
      const a = resolveAutoTarget("expand", 250, false, preference, ALL);
      const b = resolveAutoTarget("expand", 250, false, preference, ALL);
      expect(a).toEqual(b);
    }
  });
});

describe("resolveAutoTarget — pool membership", () => {
  it("never resolves to an auto-excluded specialist", () => {
    // sonar_pro is search-grounded and bills a per-request search fee the
    // per-token cost model can't see — manual pick only.
    for (const mode of MODES) {
      for (const preference of AUTO_PREFERENCES) {
        for (const media of [false, true]) {
          const { target } = resolveAutoTarget(mode.id, 100, media, preference, ALL);
          expect(TARGET_ROUTING[target].autoExcluded).toBeUndefined();
        }
      }
    }
  });
});

describe("resolveAutoTarget — tiers and reasons", () => {
  it("keeps light modes on the light ladder at the threshold", () => {
    const route = resolveAutoTarget("polish", LONG_INPUT_CHARS, false, "balanced", ALL);
    expect(route.tier).toBe("light");
    expect(route.reason).toBe("light-task");
  });

  it("escalates one character past the threshold", () => {
    const route = resolveAutoTarget(
      "polish",
      LONG_INPUT_CHARS + 1,
      false,
      "balanced",
      ALL,
    );
    expect(route.tier).toBe("heavy");
    expect(route.reason).toBe("long-input");
  });

  it("escalates on media regardless of length", () => {
    // An attachment means the prompt describes something the model must
    // reason about, not merely tidy.
    const route = resolveAutoTarget("clarify", 1, true, "balanced", ALL);
    expect(route.tier).toBe("heavy");
    expect(route.reason).toBe("media-context");
  });

  it("cannot de-escalate a heavy mode — and reports the mode as the reason", () => {
    // Size only ever pushes up. A tiny Expand is still an Expand, and even
    // with media attached the MODE is why the job is heavy.
    for (const mode of ["expand", "reformat", "target"] as const) {
      for (const [chars, media] of [
        [0, false],
        [999_999, true],
      ] as const) {
        const route = resolveAutoTarget(mode, chars, media, "balanced", ALL);
        expect(route.tier).toBe("heavy");
        expect(route.reason).toBe("heavy-mode");
      }
    }
  });

  it("treats zero-length input as small", () => {
    expect(resolveAutoTarget("condense", 0, false, "balanced", ALL).tier).toBe("light");
  });

  it("resolves to the (preference, tier) ladder head when everything is configured", () => {
    // Derived from the exported ladders rather than hardcoded ids, so a price
    // default moving doesn't rot this test — the policy is the contract.
    for (const preference of AUTO_PREFERENCES) {
      expect(resolveAutoTarget("polish", 100, false, preference, ALL).target).toBe(
        AUTO_LADDERS[preference].light[0],
      );
      expect(resolveAutoTarget("expand", 100, false, preference, ALL).target).toBe(
        AUTO_LADDERS[preference].heavy[0],
      );
    }
  });

  it("keeps the historical default: balanced + ordinary light input → Sonnet 5.5", () => {
    // The one literal pin, because it is a product statement, not economics:
    // small shape-preserving jobs go to the fast Anthropic tier, exactly as
    // the original two-outcome table did.
    expect(resolveAutoTarget("polish", 100, false, "balanced", ALL).target).toBe(
      "sonnet_5_5",
    );
  });
});

describe("resolveAutoTarget — preference economics", () => {
  it("budget never pays more than quality for the same job", () => {
    // Derived from live TARGETS via blendedPrice, so PRICE_* overrides move
    // both sides of the comparison together.
    for (const [mode, chars] of [
      ["polish", 100],
      ["expand", 100],
    ] as const) {
      const budget = resolveAutoTarget(mode, chars, false, "budget", ALL).target;
      const balanced = resolveAutoTarget(mode, chars, false, "balanced", ALL).target;
      const quality = resolveAutoTarget(mode, chars, false, "quality", ALL).target;
      expect(blendedPrice(budget)).toBeLessThanOrEqual(blendedPrice(balanced));
      expect(blendedPrice(balanced)).toBeLessThanOrEqual(blendedPrice(quality));
    }
  });

  it("quality on a heavy job picks a frontier-strength model when one is configured", () => {
    const { target } = resolveAutoTarget("expand", 100, false, "quality", ALL);
    expect(TARGET_ROUTING[target].strength).toBeGreaterThanOrEqual(9);
  });

  it("budget picks the cheapest floor-clearing model when everything is configured", () => {
    const { target } = resolveAutoTarget("expand", 100, false, "budget", ALL);
    const floorPassers = POOL.filter((t) => TARGET_ROUTING[t].strength >= 7);
    const cheapest = Math.min(...floorPassers.map(blendedPrice));
    expect(blendedPrice(target)).toBe(cheapest);
  });
});

describe("resolveAutoTarget — availability", () => {
  it("skips unconfigured candidates in ladder order", () => {
    for (const preference of AUTO_PREFERENCES) {
      const ladder = AUTO_LADDERS[preference].heavy;
      const skipHead = (t: TargetModelId) => t !== ladder[0];
      expect(resolveAutoTarget("expand", 100, false, preference, skipHead).target).toBe(
        ladder[1],
      );
    }
  });

  it("resolves to the configured provider whenever any pool member is configured", () => {
    // The bug this router exists to fix: the old table could resolve to a
    // model whose key was missing and 503 a run the user never aimed there.
    const onlyGemini = (t: TargetModelId) => t === "gemini_4_hydrogen";
    for (const mode of MODES) {
      for (const preference of AUTO_PREFERENCES) {
        expect(
          resolveAutoTarget(mode.id, 100, false, preference, onlyGemini).target,
        ).toBe("gemini_4_hydrogen");
      }
    }
  });

  it("returns the ladder head when nothing is configured (route 503s it honestly)", () => {
    const none = () => false;
    for (const preference of AUTO_PREFERENCES) {
      expect(resolveAutoTarget("expand", 100, false, preference, none).target).toBe(
        AUTO_LADDERS[preference].heavy[0],
      );
    }
  });

  it("defaults the predicate to the real key check", () => {
    // Pin the default wiring once with real env: only Anthropic configured →
    // an Anthropic target, whatever the ladder economics say.
    for (const env of Object.values(PROVIDER_KEY_ENV)) vi.stubEnv(env, "");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const { target } = resolveAutoTarget("expand", 100, false, "budget");
    expect(["fable_5_2", "opus_5_5", "sonnet_5_5"]).toContain(target);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
});

describe("resolveAutoVisionTarget", () => {
  const seeing = new Set<TargetModelId>([
    "opus_5_5",
    "gpt_6_2_sol",
    "gemini_4_hydrogen",
    "grok_4_7",
  ]);
  const canSee = (t: TargetModelId) => seeing.has(t);

  it("only returns vision-capable targets, in heavy-ladder order", () => {
    for (const preference of AUTO_PREFERENCES) {
      const target = resolveAutoVisionTarget(preference, canSee, ALL);
      expect(seeing.has(target)).toBe(true);
      expect(target).toBe(AUTO_LADDERS[preference].heavy.filter(canSee)[0]);
    }
  });

  it("skips unconfigured vision targets", () => {
    const ladder = AUTO_LADDERS.balanced.heavy.filter(canSee);
    const skipHead = (t: TargetModelId) => t !== ladder[0];
    expect(resolveAutoVisionTarget("balanced", canSee, skipHead)).toBe(ladder[1]);
  });

  it("falls back to the media route's long-standing default on an empty pool", () => {
    expect(resolveAutoVisionTarget("balanced", () => false, ALL)).toBe("opus_5_5");
  });
});

describe("defaultThinkingLevel — the Thinking dial's Auto", () => {
  const KNOBBED = TARGET_MODELS.map((m) => m.id).filter((id) => TARGETS[id].effort);

  it("gives a heavy job `high` on every model", () => {
    for (const id of KNOBBED) {
      expect(defaultThinkingLevel("expand", 10, false, id), id).toBe("high");
      expect(defaultThinkingLevel("polish", LONG_INPUT_CHARS + 1, false, id), id).toBe(
        "high",
      );
      expect(defaultThinkingLevel("clarify", 10, true, id), id).toBe("high");
    }
  });

  it("actually CHOOSES something — a light job never runs at a heavy job's depth", () => {
    // The property the 2026-11 correction exists for, stated on the WIRE:
    // for every model with a knob, the word sent for a light job must rank
    // below the word sent for a heavy one. Returning `medium` everywhere
    // failed this on every three-valued API, where medium folds onto high.
    for (const id of KNOBBED) {
      const vocabulary = TARGETS[id].effort!;
      const light = providerEffort(
        vocabulary,
        defaultThinkingLevel("polish", 10, false, id),
      );
      const heavy = providerEffort(
        vocabulary,
        defaultThinkingLevel("expand", 10, false, id),
      );
      expect(light, id).not.toBe(heavy);
    }
  });

  it("sends Medium where the API has one, and Low where it does not", () => {
    expect(defaultThinkingLevel("polish", 10, false, "opus_5_5")).toBe("medium");
    expect(defaultThinkingLevel("polish", 10, false, "gpt_6_2_sol")).toBe("medium");
    expect(defaultThinkingLevel("polish", 10, false, "gemini_4_carbon")).toBe("medium");
    expect(defaultThinkingLevel("polish", 10, false, "mistral_large_4")).toBe("medium");
    // low · high · top — no medium of their own.
    for (const id of ["deepseek_v4", "kimi_k3_1_pro", "glm_5_3", "qwen4_max"] as const)
      expect(defaultThinkingLevel("polish", 10, false, id), id).toBe("low");
  });

  it("never leaves a default-max model on its vendor default", () => {
    // Kimi, GLM, Muse Wonder and MiniMax M3.1 all default `reasoning_effort`
    // to max. Auto must resolve to something else for every job shape.
    for (const id of [
      "kimi_k3_1_pro",
      "glm_5_3",
      "muse_wonder_1_0",
      "minimax_m3_1_flash",
    ] as const) {
      for (const mode of MODES.map((m) => m.id)) {
        const word = providerEffort(
          TARGETS[id].effort!,
          defaultThinkingLevel(mode, 10, false, id),
        );
        expect(word, `${id}/${mode}`).not.toBe("max");
        expect(word, `${id}/${mode}`).toBeDefined();
      }
    }
  });

  it("falls back to the plain tier split when no target is given", () => {
    expect(defaultThinkingLevel("polish", 10, false)).toBe("medium");
    expect(defaultThinkingLevel("expand", 10, false)).toBe("high");
  });
});

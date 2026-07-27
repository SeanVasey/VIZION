import { describe, expect, it } from "vitest";
import { resolveAutoTarget, LONG_INPUT_CHARS } from "@/lib/enhance/auto-target";
import { MODES, TARGET_MODELS, TARGET_THINKING_LEVELS } from "@/lib/constants";

const ROSTER = new Set<string>(TARGET_MODELS.map((m) => m.id));

describe("resolveAutoTarget — totality", () => {
  it.each(MODES.map((m) => m.id))(
    "always resolves %s to a live roster id",
    (mode) => {
      // Auto is a wire concept; whatever it resolves to gets written to the
      // model_target ENUM columns. A cell naming a retired id would be a
      // 22P02 at insert time, long after the run was paid for.
      for (const chars of [0, 10, LONG_INPUT_CHARS, LONG_INPUT_CHARS + 1, 500_000]) {
        for (const media of [false, true]) {
          expect(ROSTER.has(resolveAutoTarget(mode, chars, media))).toBe(true);
        }
      }
    },
  );

  it("never resolves to the literal string 'auto'", () => {
    for (const m of MODES) {
      expect(resolveAutoTarget(m.id, 100, false)).not.toBe("auto");
    }
  });

  it("only resolves to targets that carry a thinking ladder", () => {
    // Otherwise Auto could land the user on a model whose thinking rail
    // vanishes from the composer with no explanation.
    for (const m of MODES) {
      for (const media of [false, true]) {
        const id = resolveAutoTarget(m.id, 100, media);
        expect(TARGET_THINKING_LEVELS[id]).toBeDefined();
      }
    }
  });
});

describe("resolveAutoTarget — the table", () => {
  it.each(["polish", "clarify", "condense"] as const)(
    "sends %s to the fast tier on ordinary input",
    (mode) => {
      expect(resolveAutoTarget(mode, 100, false)).toBe("sonnet_5");
    },
  );

  it.each(["expand", "reformat", "target"] as const)(
    "sends %s to the frontier tier even on short input",
    (mode) => {
      // These modes invent structure — that is where the frontier model shows
      // up in the output, regardless of how little text came in.
      expect(resolveAutoTarget(mode, 10, false)).toBe("opus_5");
    },
  );
});

describe("resolveAutoTarget — escalation", () => {
  it("keeps the fast tier exactly at the threshold", () => {
    expect(resolveAutoTarget("polish", LONG_INPUT_CHARS, false)).toBe("sonnet_5");
  });

  it("escalates one character past it", () => {
    expect(resolveAutoTarget("polish", LONG_INPUT_CHARS + 1, false)).toBe("opus_5");
  });

  it("escalates on media regardless of length", () => {
    // An attachment means the prompt describes something the model must reason
    // about, not merely tidy.
    expect(resolveAutoTarget("clarify", 1, true)).toBe("opus_5");
  });

  it("cannot de-escalate a frontier mode", () => {
    // Size only ever pushes up. A tiny Expand is still an Expand.
    for (const mode of ["expand", "reformat", "target"] as const) {
      expect(resolveAutoTarget(mode, 0, false)).toBe("opus_5");
      expect(resolveAutoTarget(mode, 999_999, true)).toBe("opus_5");
    }
  });

  it("treats zero-length input as small", () => {
    expect(resolveAutoTarget("condense", 0, false)).toBe("sonnet_5");
  });
});

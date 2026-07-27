import { describe, expect, it } from "vitest";
import { MODES, MODE_LABEL, type ModeId } from "@/lib/constants";
import { MODE_BLURB, MODE_INSTRUCTIONS } from "@/lib/enhance/modes";

/**
 * Mode label contract (2026-07 UX audit): the `target` mode is DISPLAYED as
 * "Adapt" while its persisted id stays `target` (the id lives in the
 * enhance_mode DB enum, localStorage, the outbox, and the API contract —
 * renaming it is a migration-class change this rename deliberately avoids).
 */
describe("mode labels", () => {
  it("the target mode is labelled Adapt, id unchanged", () => {
    expect(MODES.find((m) => m.id === "target")?.label).toBe("Adapt");
  });

  it("no mode is labelled Target anymore (regression pin)", () => {
    // Widened: the literal label union already excludes "Target" at compile
    // time; the runtime check pins it against a future re-rename.
    expect(MODES.some((m) => (m.label as string) === "Target")).toBe(false);
  });

  it("MODE_LABEL covers every mode id and mirrors the roster labels", () => {
    for (const m of MODES) {
      expect(MODE_LABEL[m.id]).toBe(m.label);
    }
    expect(Object.keys(MODE_LABEL).sort()).toEqual(MODES.map((m) => m.id).sort());
  });

  it("every mode carries an instruction and a blurb", () => {
    for (const m of MODES) {
      expect(MODE_INSTRUCTIONS[m.id as ModeId].length).toBeGreaterThan(0);
      expect(MODE_BLURB[m.id as ModeId].length).toBeGreaterThan(0);
    }
  });
});

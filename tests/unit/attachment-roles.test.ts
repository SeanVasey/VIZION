import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROLE,
  ROLE_META,
  rolesForKind,
  type AttachmentRole,
} from "@/lib/media/types";

/**
 * The attachment-role contract (2026-07 UX audit): reference is the default —
 * "generate" must be an explicit choice, never inferred from a file's mere
 * presence — and audio (which never reaches a model) can't take the
 * model-analysis roles.
 */
describe("attachment roles", () => {
  it("the default role is reference, not generate", () => {
    expect(DEFAULT_ROLE).toBe("reference");
  });

  it("every role has a label and a plain-language blurb", () => {
    for (const role of Object.keys(ROLE_META) as AttachmentRole[]) {
      expect(ROLE_META[role].label.length).toBeGreaterThan(0);
      expect(ROLE_META[role].blurb.length).toBeGreaterThan(0);
    }
  });

  it("audio offers only reference and generate (metadata-only honesty)", () => {
    expect(rolesForKind("audio")).toEqual(["reference", "generate"]);
  });

  it("image and video offer the full role set", () => {
    for (const kind of ["image", "video"] as const) {
      expect(rolesForKind(kind)).toEqual([
        "reference",
        "extract",
        "describe",
        "style",
        "generate",
      ]);
    }
  });
});

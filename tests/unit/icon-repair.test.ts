import { describe, expect, it } from "vitest";
import { verifyIconRepair } from "../../scripts/verify-icon-repair.mjs";

describe("icon repair assets and isolated diagnostic", () => {
  it("preserves canonical pixels, alpha contracts, references and isolation", async () => {
    const result = await verifyIconRepair();
    expect(result.status).toBe("passed");
    expect(result.checks).toHaveLength(9);
  }, 30_000);
});

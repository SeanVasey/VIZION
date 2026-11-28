import { describe, it, expect } from "vitest";
import { computeCost } from "@/lib/providers/config";
import { toMarkdown, toJson, toText, type ExportData } from "@/lib/enhance/export";

describe("computeCost", () => {
  it("computes Opus cost from token counts ($4/$20 per MTok default)", () => {
    // 1M in + 1M out = $4 + $20 = $24
    expect(computeCost("opus_5_5", 1_000_000, 1_000_000)).toBe(24);
  });

  it("is zero for zero tokens", () => {
    expect(computeCost("gpt_6_2_sol", 0, 0)).toBe(0);
  });

  it("rounds to 6 decimal places", () => {
    const c = computeCost("opus_5_5", 1, 1);
    expect(c).toBeCloseTo(0.000024, 6);
  });
});

const data: ExportData = {
  input: "write a summary",
  output: "Write a concise summary.",
  rationale: "Tightened the ask.",
  mode: "clarify",
  target: "opus_5_5",
  modelUsed: "claude-opus-5-5",
};

describe("exporters", () => {
  it("markdown includes input, output, and rationale", () => {
    const md = toMarkdown(data);
    expect(md).toContain("write a summary");
    expect(md).toContain("Write a concise summary.");
    expect(md).toContain("Tightened the ask.");
    expect(md).toContain("Opus 5.5");
  });

  it("json round-trips the fields", () => {
    const parsed = JSON.parse(toJson(data));
    expect(parsed.output).toBe("Write a concise summary.");
    expect(parsed.mode).toBe("clarify");
    expect(parsed.model).toBe("claude-opus-5-5");
  });

  it("text is just the output", () => {
    expect(toText(data).trim()).toBe("Write a concise summary.");
  });
});

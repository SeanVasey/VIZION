import { describe, it, expect } from "vitest";
import { deriveTitle, parseTags, filterPrompts, relativeTime } from "@/lib/library/util";

describe("deriveTitle", () => {
  it("uses the first line", () => {
    expect(deriveTitle("Write a launch email\nwith details")).toBe(
      "Write a launch email",
    );
  });
  it("truncates long single lines with an ellipsis", () => {
    const t = deriveTitle("x".repeat(100), 10);
    expect(t.length).toBe(10);
    expect(t.endsWith("…")).toBe(true);
  });
  it("falls back for empty input", () => {
    expect(deriveTitle("   ")).toBe("Untitled prompt");
  });
});

describe("parseTags", () => {
  it("splits, strips #, lowercases, de-dupes", () => {
    expect(parseTags("#Marketing, code, marketing\nCode")).toEqual(["marketing", "code"]);
  });
  it("returns empty for blank", () => {
    expect(parseTags("  , ,")).toEqual([]);
  });
});

describe("filterPrompts", () => {
  const prompts = [
    { title: "Launch email", tags: ["marketing"], target_model: "opus_5" },
    { title: "JSON spec", tags: ["code"], target_model: "gpt_5_6_sol" },
  ];
  it("filters by query against title and tags", () => {
    expect(
      filterPrompts(prompts, { query: "launch", tag: null, model: null }),
    ).toHaveLength(1);
    expect(
      filterPrompts(prompts, { query: "code", tag: null, model: null }),
    ).toHaveLength(1);
  });
  it("filters by tag and model", () => {
    expect(
      filterPrompts(prompts, { query: "", tag: "code", model: null })[0]!.title,
    ).toBe("JSON spec");
    expect(
      filterPrompts(prompts, { query: "", tag: null, model: "opus_5" })[0]!.title,
    ).toBe("Launch email");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-06-13T12:00:00Z").getTime();
  it("reports just now for very recent", () => {
    expect(relativeTime("2026-06-13T11:59:40Z", now)).toBe("just now");
  });
  it("reports minutes and hours", () => {
    expect(relativeTime("2026-06-13T11:30:00Z", now)).toBe("30m");
    expect(relativeTime("2026-06-13T09:00:00Z", now)).toBe("3h");
  });
  it("reports days", () => {
    expect(relativeTime("2026-06-11T12:00:00Z", now)).toBe("2d");
  });
});

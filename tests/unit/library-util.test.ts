import { describe, it, expect } from "vitest";
import { deriveTitle, parseTags, relativeTime } from "@/lib/library/util";

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

// filterPrompts is gone: search/filter/sort moved server-side (paging.ts +
// queries.ts) — the client no longer filters an already-complete list.

describe("relativeTime (human copy)", () => {
  const now = new Date("2026-06-13T12:00:00Z").getTime();
  it("reports Now for very recent", () => {
    expect(relativeTime("2026-06-13T11:59:40Z", now)).toBe("Now");
  });
  it("never renders the old 0m window — 45-59s reads as 1 min ago", () => {
    expect(relativeTime("2026-06-13T11:59:10Z", now)).toBe("1 min ago");
  });
  it("reports minutes and hours in words", () => {
    expect(relativeTime("2026-06-13T11:30:00Z", now)).toBe("30 min ago");
    expect(relativeTime("2026-06-13T09:00:00Z", now)).toBe("3 hr ago");
  });
  it("reports calendar-yesterday as Yesterday", () => {
    expect(relativeTime("2026-06-12T09:00:00Z", now)).toBe("Yesterday");
  });
  it("reports recent days, then falls back to a date", () => {
    expect(relativeTime("2026-06-10T12:00:00Z", now)).toBe("3 days ago");
    expect(relativeTime("2026-05-01T12:00:00Z", now)).toBe(
      new Date("2026-05-01T12:00:00Z").toLocaleDateString(),
    );
  });
});

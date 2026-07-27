import { describe, it, expect } from "vitest";
import {
  diffWords,
  boundedDiffWords,
  countChangedSections,
  toHunks,
  applyDecisions,
} from "@/lib/enhance/diff";

describe("diffWords", () => {
  it("marks everything equal for identical text", () => {
    const segs = diffWords("hello world", "hello world");
    expect(segs.every((s) => s.op === "equal")).toBe(true);
    expect(countChangedSections(segs)).toBe(0);
  });

  it("reconstructs the output losslessly from equal + added segments", () => {
    const after = "write a concise, friendly summary";
    const segs = diffWords("write a summary", after);
    const rebuilt = segs
      .filter((s) => s.op !== "removed")
      .map((s) => s.text)
      .join("");
    expect(rebuilt).toBe(after);
  });

  it("reconstructs the input from equal + removed segments", () => {
    const before = "write a long detailed summary";
    const segs = diffWords(before, "write a summary");
    const rebuilt = segs
      .filter((s) => s.op !== "added")
      .map((s) => s.text)
      .join("");
    expect(rebuilt).toBe(before);
  });

  it("flags added tokens when the prompt is expanded", () => {
    const segs = diffWords("summarize", "summarize in three bullet points");
    expect(segs.some((s) => s.op === "added")).toBe(true);
    expect(countChangedSections(segs)).toBeGreaterThan(0);
  });

  it("handles empty input", () => {
    const segs = diffWords("", "brand new prompt");
    expect(segs.every((s) => s.op === "added")).toBe(true);
  });
});

describe("countChangedSections", () => {
  it("counts a replaced phrase (removed + added adjacent) as ONE section", () => {
    // "quick" → "slow": the LCS diff yields removed("quick") + added("slow")
    // side by side — the old per-segment count said 2; the user sees 1 edit.
    const segs = diffWords("the quick fox", "the slow fox");
    expect(countChangedSections(segs)).toBe(1);
  });

  it("counts two disjoint edits as two sections", () => {
    const segs = diffWords(
      "the quick fox jumps over the lazy dog",
      "the slow fox jumps over the eager dog",
    );
    expect(countChangedSections(segs)).toBe(2);
  });

  it("counts a pure insertion as one section", () => {
    const segs = diffWords("summarize this", "summarize this in three bullets");
    expect(countChangedSections(segs)).toBe(1);
  });

  it("a whitespace-only equal segment does not split a section", () => {
    // Replacing two adjacent words leaves an equal " " between the two
    // removed/added pairs; the user still made one contiguous edit.
    const segs = diffWords("alpha beta gamma", "alpha delta epsilon");
    expect(countChangedSections(segs)).toBe(1);
  });

  it("whitespace-only churn counts zero sections", () => {
    expect(
      countChangedSections([
        { op: "equal", text: "hello" },
        { op: "removed", text: " " },
        { op: "added", text: "  " },
        { op: "equal", text: "world" },
      ]),
    ).toBe(0);
  });

  it("a fully-new prompt is one section", () => {
    expect(countChangedSections(diffWords("", "brand new prompt"))).toBe(1);
  });
});

describe("boundedDiffWords", () => {
  it("matches diffWords under the budget", () => {
    expect(boundedDiffWords("a b c", "a x c")).toEqual(diffWords("a b c", "a x c"));
  });
  it("returns null when either side exceeds the budget", () => {
    const big = Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ");
    expect(boundedDiffWords(big, "short", 100)).toBeNull();
    expect(boundedDiffWords("short", big, 100)).toBeNull();
    expect(boundedDiffWords(big, big, 1000)).not.toBeNull();
  });
});

describe("toHunks / applyDecisions (per-change accept/reject)", () => {
  const BEFORE = "the quick brown fox jumps over the lazy dog";
  const AFTER = "the slow brown fox leaps over the eager old dog";

  it("groups adjacent edits into hunks with both sides readable", () => {
    const hunks = toHunks(diffWords("the quick fox", "the slow fox"));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.removed).toBe("quick");
    expect(hunks[0]!.added).toBe("slow");
  });

  it("whitespace-bridged adjacent word replacements form ONE hunk", () => {
    const hunks = toHunks(diffWords("alpha beta gamma", "alpha delta epsilon"));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.removed).toBe("beta gamma");
    expect(hunks[0]!.added).toBe("delta epsilon");
  });

  it("rejecting nothing reconstructs exactly the AFTER text", () => {
    expect(applyDecisions(diffWords(BEFORE, AFTER), new Set())).toBe(AFTER);
  });

  it("rejecting every hunk reconstructs exactly the BEFORE text", () => {
    const segs = diffWords(BEFORE, AFTER);
    const all = new Set(toHunks(segs).map((h) => h.index));
    expect(applyDecisions(segs, all)).toBe(BEFORE);
  });

  it("partial rejection mixes sides per hunk", () => {
    const segs = diffWords(BEFORE, AFTER);
    const hunks = toHunks(segs);
    expect(hunks.length).toBeGreaterThanOrEqual(2);
    // Reject only the first hunk (quick→slow stays "quick"); keep the rest.
    const rejected = new Set([hunks[0]!.index]);
    const text = applyDecisions(segs, rejected);
    expect(text).toContain("quick");
    expect(text).toContain("eager old");
    expect(text).not.toContain("slow brown");
  });

  it("empty diff yields no hunks and identity reconstruction", () => {
    const segs = diffWords("same text", "same text");
    expect(toHunks(segs)).toHaveLength(0);
    expect(applyDecisions(segs, new Set())).toBe("same text");
  });
});

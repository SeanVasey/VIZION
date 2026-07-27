import { describe, it, expect } from "vitest";
import { diffWords, countChangedSections } from "@/lib/enhance/diff";

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

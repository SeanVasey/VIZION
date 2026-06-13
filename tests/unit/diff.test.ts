import { describe, it, expect } from "vitest";
import { diffWords, countChanges } from "@/lib/enhance/diff";

describe("diffWords", () => {
  it("marks everything equal for identical text", () => {
    const segs = diffWords("hello world", "hello world");
    expect(segs.every((s) => s.op === "equal")).toBe(true);
    expect(countChanges(segs)).toBe(0);
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
    expect(countChanges(segs)).toBeGreaterThan(0);
  });

  it("handles empty input", () => {
    const segs = diffWords("", "brand new prompt");
    expect(segs.every((s) => s.op === "added")).toBe(true);
  });
});

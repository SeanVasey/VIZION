import { describe, expect, it, vi } from "vitest";

// The flusher module imports the server action and the toast hook; neither
// is exercised by the pure payload guard under test.
vi.mock("@/lib/library/actions", () => ({ savePromptAction: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: vi.fn() }) }));

import { isSavePromptPayload } from "@/components/pwa/OutboxFlusher";

const BASE = {
  input: "i",
  output: "o",
  mode: "clarify",
  modelUsed: "m",
  tokenIn: 1,
  tokenOut: 1,
};

describe("isSavePromptPayload — a save queued before a roster rename", () => {
  it("accepts a RETIRED target id, so the server can fold it forward", () => {
    // Parking it as poison here is what lost every offline save queued before
    // the deploy that renamed the default target (Bugbot, PR #129).
    expect(isSavePromptPayload({ ...BASE, target: "opus_5" })).toBe(true);
    expect(isSavePromptPayload({ ...BASE, target: "gemini_pro_3_1" })).toBe(true);
  });

  it("accepts a live id and still rejects what was never a target", () => {
    expect(isSavePromptPayload({ ...BASE, target: "opus_5_5" })).toBe(true);
    expect(isSavePromptPayload({ ...BASE, target: "bogus" })).toBe(false);
    expect(isSavePromptPayload({ ...BASE, target: "constructor" })).toBe(false);
    expect(isSavePromptPayload({ ...BASE, target: 5 })).toBe(false);
  });
});

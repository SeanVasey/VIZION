import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { diffWords } from "@/lib/enhance/diff";
import type { EnhanceResponse } from "@/lib/enhance/use-enhance";

const savePromptAction = vi.fn(async (): Promise<Record<string, unknown>> => ({
  ok: true,
  promptId: "p1",
}));
const addVersionAction = vi.fn(async () => ({ ok: true, promptId: "p1" }));
vi.mock("@/lib/library/actions", () => ({
  savePromptAction: (...args: unknown[]) => savePromptAction(...args),
  addVersionAction: (...args: unknown[]) =>
    addVersionAction(...(args as Parameters<typeof addVersionAction>)),
  logShareAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/pwa/outbox", () => ({
  enqueueOutbox: vi.fn(async () => {}),
}));

import { TransformationDiff } from "@/components/diff/TransformationDiff";

function makeResult(
  input: string,
  output: string,
  extra: Partial<EnhanceResponse> = {},
): EnhanceResponse {
  return {
    output,
    rationale: "Tightened the ask.",
    diff: diffWords(input, output),
    tokenIn: 10,
    tokenOut: 20,
    modelUsed: "test-model",
    costUsd: 0.001,
    usage: { todayCost: 0.01, capUsd: 2 },
    ...extra,
  };
}

let clipboardWrite: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  clipboardWrite = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: clipboardWrite },
    configurable: true,
  });
});

function renderView(props: Partial<Parameters<typeof TransformationDiff>[0]> = {}) {
  const input = props.input ?? "write a summary";
  const result = props.result ?? makeResult(input, "write a concise summary");
  return render(
    <ToastProvider>
      <TransformationDiff
        input={input}
        mode={props.mode ?? "clarify"}
        target={props.target ?? "opus_5"}
        result={result}
        {...props}
      />
    </ToastProvider>,
  );
}

describe("result view (mobile-first order)", () => {
  it("shows Enhanced first, rationale after, original last", () => {
    renderView();
    const enhanced = screen.getByText("Enhanced");
    const rationale = screen.getByText("What changed");
    const original = screen.getByRole("button", { name: /original/ });
    // DOM order: Enhanced precedes rationale precedes the original toggle.
    expect(
      enhanced.compareDocumentPosition(rationale) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      rationale.compareDocumentPosition(original) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps a short original expanded", () => {
    renderView();
    expect(screen.getByRole("button", { name: /hide original/i })).toBeTruthy();
    expect(screen.getByText("Input")).toBeTruthy();
  });

  it("collapses a long original by default and expands on demand", () => {
    const input = `${"lorem ipsum dolor sit amet ".repeat(30)}end`;
    renderView({ input, result: makeResult(input, `${input} improved`) });
    expect(screen.queryByText("Input")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /show original/i }));
    expect(screen.getByText("Input")).toBeTruthy();
  });

  it("surfaces a copy failure as an error toast instead of silence", async () => {
    clipboardWrite.mockRejectedValueOnce(new Error("denied"));
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't copy/i);
  });

  it("Use as draft hands the output to onUse", () => {
    const onUse = vi.fn();
    renderView({ onUse });
    fireEvent.click(screen.getByRole("button", { name: "Use as draft" }));
    expect(onUse).toHaveBeenCalledWith("write a concise summary");
  });

  it("renders the assumptions card only when assumptions exist", () => {
    renderView();
    expect(screen.queryByText("Assumptions made")).toBeNull();
    renderView({
      result: makeResult("a", "b", { assumptions: ["audience is technical"] }),
    });
    expect(screen.getByText("Assumptions made")).toBeTruthy();
    expect(screen.getByText(/audience is technical/)).toBeTruthy();
  });

  it("renders targetNotes in a destination card when present", () => {
    renderView({
      mode: "expand",
      result: makeResult("a", "b c", { targetNotes: "Added XML sections." }),
    });
    expect(screen.getByText("For Opus 5")).toBeTruthy();
    expect(screen.getByText("Added XML sections.")).toBeTruthy();
  });

  it("states the shape-preserving honesty line for clarify/polish without notes", () => {
    renderView({ mode: "clarify" });
    expect(screen.getByText(/keeps your prompt/)).toBeTruthy();
    expect(screen.getByText(/no Opus 5-specific formatting was applied/)).toBeTruthy();
  });

  it("fires onRefine with the kind and the current output", () => {
    const onRefine = vi.fn();
    renderView({ onRefine });
    fireEvent.click(screen.getByRole("button", { name: "Make shorter" }));
    expect(onRefine).toHaveBeenCalledWith("shorter", "write a concise summary");
  });

  it("disables refine chips while a refinement is pending", () => {
    renderView({ onRefine: vi.fn(), refinePending: true });
    expect(screen.getByRole("button", { name: "More detail" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Refining…");
  });
});

describe("duplicate detection at save", () => {
  it("offers Open / Save as new version instead of a second card", async () => {
    savePromptAction.mockResolvedValueOnce({
      ok: false,
      duplicate: { promptId: "p9", title: "Launch email" },
    });
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Save to library" }));
    expect(await screen.findByText(/Already in your library as/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/library/p9",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save as new version" }));
    expect(addVersionAction).toHaveBeenCalledWith(
      "p9",
      expect.objectContaining({ output: "write a concise summary" }),
    );
    // Resolves into the normal saved state.
    expect(await screen.findByText(/Saved ✓/)).toBeTruthy();
  });
});

describe("Polish per-change accept/reject", () => {
  const INPUT = "the quick fox";
  const OUTPUT = "the slow fox";

  it("shows the review list only for polish", () => {
    renderView({ mode: "clarify", input: INPUT, result: makeResult(INPUT, OUTPUT) });
    expect(screen.queryByText(/review changes/i)).toBeNull();
    renderView({ mode: "polish", input: INPUT, result: makeResult(INPUT, OUTPUT) });
    expect(screen.getByText("Review changes (1)")).toBeTruthy();
  });

  it("reverting a change makes Copy produce the reconstructed text", async () => {
    renderView({ mode: "polish", input: INPUT, result: makeResult(INPUT, OUTPUT) });
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    expect(screen.getByText("0/1 changes kept")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(clipboardWrite).toHaveBeenCalledWith(INPUT);
    // Re-keeping restores the model output.
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(clipboardWrite).toHaveBeenLastCalledWith(OUTPUT);
  });

  it("Use as draft consumes the decision-applied output", () => {
    const onUse = vi.fn();
    renderView({
      mode: "polish",
      input: INPUT,
      result: makeResult(INPUT, OUTPUT),
      onUse,
    });
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    fireEvent.click(screen.getByRole("button", { name: "Use as draft" }));
    expect(onUse).toHaveBeenCalledWith(INPUT);
  });

  it("Revert all / Keep all flip every hunk", () => {
    const input = "alpha one beta two gamma";
    const output = "alpha ONE beta TWO gamma";
    renderView({ mode: "polish", input, result: makeResult(input, output) });
    fireEvent.click(screen.getByRole("button", { name: "Revert all" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(clipboardWrite).toHaveBeenLastCalledWith(input);
    fireEvent.click(screen.getByRole("button", { name: "Keep all" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(clipboardWrite).toHaveBeenLastCalledWith(output);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { diffWords } from "@/lib/enhance/diff";
import type { EnhanceResponse } from "@/lib/enhance/use-enhance";

const savePromptAction = vi.fn(
  async (..._args: unknown[]): Promise<Record<string, unknown>> => ({
    ok: true,
    promptId: "p1",
  }),
);
const addVersionAction = vi.fn(async (..._args: unknown[]) => ({
  ok: true,
  promptId: "p1",
}));
vi.mock("@/lib/library/actions", () => ({
  savePromptAction: (...args: unknown[]) => savePromptAction(...args),
  addVersionAction: (...args: unknown[]) => addVersionAction(...args),
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

// Global stubs must be torn down even when a test fails mid-body — an
// IntersectionObserver leaking into a later test arms the sticky action bar
// there, duplicating its buttons and breaking unrelated queries. (This was a
// real intermittent failure before the teardown moved here.)
afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("collapses the original by default — even a short one", () => {
    // The enhanced prompt is the primary object; on a phone any original
    // pushes the rationale and actions off-screen.
    renderView();
    expect(screen.queryByText("Input")).toBeNull();
    expect(screen.getByRole("button", { name: /show original/i })).toBeTruthy();
  });

  it("expands the original on demand and collapses it again", () => {
    const input = `${"lorem ipsum dolor sit amet ".repeat(30)}end`;
    renderView({ input, result: makeResult(input, `${input} improved`) });
    expect(screen.queryByText("Input")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /show original/i }));
    expect(screen.getByText("Input")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /hide original/i }));
    expect(screen.queryByText("Input")).toBeNull();
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

  it("arms sticky Copy/Use only once the real action row leaves the viewport", () => {
    // jsdom has no IntersectionObserver; install one we can drive.
    let notify: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
    class FakeIO {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        notify = cb;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", FakeIO);

    const onUse = vi.fn();
    renderView({ onUse });
    // Row visible → exactly one Copy and one Use as draft.
    expect(screen.getAllByRole("button", { name: "Copy" })).toHaveLength(1);

    act(() => notify?.([{ isIntersecting: false }]));
    expect(screen.getAllByRole("button", { name: "Copy" })).toHaveLength(2);
    // The sticky copy drives the same handler.
    fireEvent.click(screen.getAllByRole("button", { name: "Use as draft" })[1]!);
    expect(onUse).toHaveBeenCalledWith("write a concise summary");

    act(() => notify?.([{ isIntersecting: true }]));
    expect(screen.getAllByRole("button", { name: "Copy" })).toHaveLength(1);
  });

  it("renders no What-changed heading when the rationale is empty", () => {
    renderView({ result: makeResult("a", "b", { rationale: "" }) });
    expect(screen.queryByText("What changed")).toBeNull();
    // The model/cost meta line still renders regardless.
    expect(screen.getByText(/test-model/)).toBeTruthy();
  });

  it("says the explanation was cut off on a salvaged result", () => {
    renderView({ result: makeResult("a", "b", { rationale: "", salvaged: true }) });
    expect(screen.queryByText("What changed")).toBeNull();
    expect(
      screen.getByText(/explanation was cut off — the prompt above is complete/),
    ).toBeTruthy();
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
    // findBy, not getBy: the button's label is `saving ? "Saving…" : …`, and
    // the save transition can still be pending when the duplicate banner
    // commits — so the settled label has to be waited for, not assumed. A
    // getBy here passes on an idle machine and flakes under suite load.
    fireEvent.click(await screen.findByRole("button", { name: "Save as new version" }));
    expect(addVersionAction).toHaveBeenCalledWith(
      "p9",
      expect.objectContaining({ output: "write a concise summary" }),
    );
    // Resolves into the normal saved state ("Saved" + check glyph — the mark
    // is an aria-hidden SVG now, so the match is on the text alone).
    expect(await screen.findByText(/Saved/)).toBeTruthy();
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

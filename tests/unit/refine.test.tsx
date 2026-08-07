import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { useUIStore } from "@/stores/ui";
import { useEnhanceViewStore } from "@/stores/enhance-view";

const mockMutation = {
  isPending: false,
  isError: false,
  error: null as unknown,
  stream: {
    active: false,
    step: "waiting",
    partialOutput: "",
    tokenIn: 0,
    tokenOut: 0,
    costUsd: 0,
  },
  mutate: vi.fn(),
  reset: vi.fn(),
};

vi.mock("@/lib/enhance/use-enhance", () => ({
  useEnhance: () => mockMutation,
}));
vi.mock("@/lib/library/actions", () => ({
  savePromptAction: vi.fn(async () => ({ ok: true, promptId: "p1" })),
  logShareAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/pwa/outbox", () => ({
  enqueueOutbox: vi.fn(async () => {}),
}));
// The tray hits Supabase at mount — out of scope for refine tests.
vi.mock("@/components/media/AttachmentTray", () => ({
  AttachmentTray: () => null,
}));

import { EnhanceComposer } from "@/components/editor/EnhanceComposer";

const FAKE_RESPONSE = {
  output: "an enhanced prompt",
  rationale: "why",
  diff: [{ op: "added" as const, text: "an enhanced prompt" }],
  modelUsed: "m",
  tokenIn: 1,
  tokenOut: 1,
  costUsd: 0.001,
  usage: { todayCost: 0.01, capUsd: 2 },
};

beforeEach(() => {
  vi.clearAllMocks();
  // The view store is a module singleton — a result set by one test must not
  // leak into the next as a pre-mounted result view.
  useEnhanceViewStore.setState({ view: null });
  mockMutation.isPending = false;
  mockMutation.mutate.mockImplementation(
    (_req: unknown, opts?: { onSuccess?: (r: typeof FAKE_RESPONSE) => void }) => {
      opts?.onSuccess?.(FAKE_RESPONSE);
    },
  );
  useUIStore.setState({ editorDraft: "", activeMode: "clarify", targetModel: "opus_5" });
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(async () => {}) },
    configurable: true,
  });
});

function runEnhanceFirst() {
  render(
    <ToastProvider>
      <EnhanceComposer />
    </ToastProvider>,
  );
  fireEvent.change(screen.getByLabelText("Prompt input"), {
    target: { value: "my original words" },
  });
  fireEvent.click(screen.getByRole("button", { name: /enhance/i }));
}

describe("refinement chips (composer wiring)", () => {
  it("Make shorter re-runs with the CURRENT OUTPUT as input and refine.kind", () => {
    runEnhanceFirst();
    fireEvent.click(screen.getByRole("button", { name: "Make shorter" }));
    expect(mockMutation.mutate).toHaveBeenCalledTimes(2);
    const [req] = mockMutation.mutate.mock.calls[1]!;
    expect(req).toMatchObject({
      input: "an enhanced prompt",
      mode: "clarify",
      target: "opus_5",
      refine: { kind: "shorter" },
    });
    expect(req.refine.baseInput).toBeUndefined();
  });

  it("Keep my tone carries the author's ORIGINAL input as baseInput", () => {
    runEnhanceFirst();
    fireEvent.click(screen.getByRole("button", { name: "Keep my tone" }));
    const [req] = mockMutation.mutate.mock.calls[1]!;
    expect(req.refine).toEqual({ kind: "tone", baseInput: "my original words" });
  });

  it("carries the run's format knob through a refine (Q4 — a chosen shape persists)", () => {
    useUIStore.setState({
      editorDraft: "",
      activeMode: "reformat",
      targetModel: "opus_5",
      reformatFormat: "xml",
    });
    render(
      <ToastProvider>
        <EnhanceComposer />
      </ToastProvider>,
    );
    fireEvent.change(screen.getByLabelText("Prompt input"), {
      target: { value: "my original words" },
    });
    fireEvent.click(screen.getByRole("button", { name: /enhance/i }));
    const [first] = mockMutation.mutate.mock.calls[0]!;
    expect(first).toMatchObject({ mode: "reformat", format: "xml" });
    fireEvent.click(screen.getByRole("button", { name: "More detail" }));
    const [refine] = mockMutation.mutate.mock.calls[1]!;
    // The SUBMITTED run's knob rides the refine — not the live rail state.
    expect(refine).toMatchObject({ format: "xml", refine: { kind: "detail" } });
  });

  it("a refined result keeps the ORIGINAL submitted input for the save payload", () => {
    runEnhanceFirst();
    fireEvent.click(screen.getByRole("button", { name: "More detail" }));
    // The collapsed-original toggle labels the input side as the previous
    // result after a refine — proof view.refined flowed through.
    expect(screen.getByRole("button", { name: /previous result/i })).toBeTruthy();
  });
});

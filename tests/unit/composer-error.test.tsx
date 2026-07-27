import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { useUIStore } from "@/stores/ui";

/**
 * The failed-run recovery surface: streamed partial output stays actionable
 * (Copy / Use as draft) and never stacks on top of a still-rendered previous
 * result (the failed-refine case).
 */
const mockMutation = {
  isPending: false,
  isError: true as boolean,
  error: {
    status: 502,
    message: "The model returned a non-JSON response.",
  } as unknown,
  stream: {
    active: false,
    step: "waiting",
    partialOutput: "salvage me",
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
vi.mock("@/components/diff/TransformationDiff", () => ({
  TransformationDiff: ({ input }: { input: string }) => (
    <div data-testid="result-view">{input}</div>
  ),
}));
vi.mock("@/components/media/AttachmentTray", () => ({
  AttachmentTray: () => null,
}));

import { EnhanceComposer } from "@/components/editor/EnhanceComposer";

const FAKE_RESPONSE = {
  output: "better prompt",
  rationale: "why",
  diff: [],
  modelUsed: "m",
  tokenIn: 1,
  tokenOut: 1,
  costUsd: 0.001,
  usage: { todayCost: 0.01, capUsd: 2 },
};

function renderComposer() {
  return render(
    <ToastProvider>
      <EnhanceComposer />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMutation.isPending = false;
  mockMutation.isError = true;
  mockMutation.stream.partialOutput = "salvage me";
  mockMutation.mutate.mockImplementation(
    (_req: unknown, opts?: { onSuccess?: (r: typeof FAKE_RESPONSE) => void }) => {
      opts?.onSuccess?.(FAKE_RESPONSE);
    },
  );
  useUIStore.setState({ editorDraft: "" });
  // jsdom implements neither — handleUse touches both on click.
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("composer failed-run recovery", () => {
  it("renders the partial output with Copy and Use-as-draft actions", () => {
    renderComposer();
    expect(screen.getByRole("alert")).toHaveTextContent("non-JSON response");
    expect(screen.getByText("salvage me")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use as draft" }));
    expect(
      (screen.getByLabelText("Prompt input") as HTMLTextAreaElement).value,
    ).toBe("salvage me");
  });

  it("suppresses the partial card while a previous result is still rendered", () => {
    renderComposer();
    // Produce a successful view first (the failed-refine shape: view stays
    // set, then a later run errors with a partial).
    fireEvent.change(screen.getByLabelText("Prompt input"), {
      target: { value: "first run" },
    });
    fireEvent.click(screen.getByRole("button", { name: /enhance/i }));
    expect(screen.getByTestId("result-view")).toHaveTextContent("first run");
    // The previous result is the recovery material — no stacked partial.
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText("salvage me")).toBeNull();
    expect(screen.queryByRole("button", { name: "Use as draft" })).toBeNull();
  });

  it("shows no partial card when nothing streamed before the failure", () => {
    mockMutation.stream.partialOutput = "";
    renderComposer();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
  });
});

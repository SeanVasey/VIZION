import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { useUIStore } from "@/stores/ui";
import { useEnhanceViewStore } from "@/stores/enhance-view";
import type { EnhanceRequest } from "@/lib/enhance/use-enhance";

const mockMutation = {
  isPending: false,
  isError: false as boolean,
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
vi.mock("@/lib/enhance/use-enhance", () => ({ useEnhance: () => mockMutation }));
vi.mock("@/components/media/AttachmentTray", () => ({ AttachmentTray: () => null }));

import { EnhanceComposer } from "@/components/editor/EnhanceComposer";

function renderComposer() {
  return render(
    <ToastProvider>
      <EnhanceComposer />
    </ToastProvider>,
  );
}

/** The request object handed to the mutation on the Nth call. */
function requestAt(n: number): EnhanceRequest {
  return mockMutation.mutate.mock.calls[n]![0] as EnhanceRequest;
}

/** Drive a first pass, then settle it with a result. */
function runAndSettle(result: Record<string, unknown>) {
  fireEvent.change(screen.getByLabelText("Prompt input"), {
    target: { value: "a prompt worth routing" },
  });
  fireEvent.click(screen.getByRole("button", { name: /enhance/i }));
  const opts = mockMutation.mutate.mock.calls.at(-1)![1] as {
    onSuccess: (r: unknown) => void;
  };
  // Settling the mutation by hand is a state update React must see inside act.
  act(() => opts.onSuccess(result));
}

const BASE_RESULT = {
  output: "routed output",
  rationale: "why",
  diff: [{ op: "equal" as const, text: "routed output" }],
  tokenIn: 1,
  tokenOut: 1,
  modelUsed: "claude-sonnet-5",
  costUsd: 0.001,
  usage: { todayCost: 0.001, capUsd: 5 },
};

beforeEach(() => {
  vi.clearAllMocks();
  // The view store is a module singleton — a result set by one test must not
  // leak into the next as a pre-mounted result view.
  useEnhanceViewStore.setState({ view: null });
  useUIStore.setState({
    editorDraft: "",
    autoTarget: false,
    targetModel: "opus_5",
    activeMode: "clarify",
  });
});

describe("Auto routing on the wire", () => {
  it("sends no auto flag when routing is off", () => {
    renderComposer();
    fireEvent.change(screen.getByLabelText("Prompt input"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: /enhance/i }));
    expect(requestAt(0).auto).toBeUndefined();
    expect(requestAt(0).target).toBe("opus_5");
  });

  it("sends auto BESIDE a real target, never instead of one", () => {
    // model_target is a Postgres enum; a request carrying "auto" as the target
    // would have nowhere to be written even if the run succeeded.
    useUIStore.setState({ autoTarget: true });
    renderComposer();
    fireEvent.change(screen.getByLabelText("Prompt input"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: /enhance/i }));
    expect(requestAt(0).auto).toBe(true);
    expect(requestAt(0).target).toBe("opus_5");
    expect(String(requestAt(0).target)).not.toBe("auto");
  });

  it("pins a refine to the model that actually ran, and stops re-routing", () => {
    // Re-routing halfway through an iteration would change voice mid-thread,
    // and the routing decision for this result was already made.
    useUIStore.setState({ autoTarget: true });
    renderComposer();
    runAndSettle({ ...BASE_RESULT, resolvedTarget: "sonnet_5" });

    fireEvent.click(screen.getByRole("button", { name: "Make shorter" }));
    const refine = requestAt(1);
    expect(refine.target).toBe("sonnet_5");
    expect(refine.auto).toBeUndefined();
  });

  it("falls back to the submitted target when a run reports no routing", () => {
    renderComposer();
    runAndSettle(BASE_RESULT);
    fireEvent.click(screen.getByRole("button", { name: "Make shorter" }));
    expect(requestAt(1).target).toBe("opus_5");
  });

  it("names the model Auto chose in the result meta", () => {
    useUIStore.setState({ autoTarget: true });
    renderComposer();
    runAndSettle({ ...BASE_RESULT, resolvedTarget: "sonnet_5" });
    expect(screen.getByText(/Auto → Sonnet 5/)).toBeTruthy();
  });

  it("says nothing about routing on a run the user routed themselves", () => {
    renderComposer();
    runAndSettle(BASE_RESULT);
    expect(screen.queryByText(/Auto →/)).toBeNull();
  });
});

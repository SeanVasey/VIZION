import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { useUIStore } from "@/stores/ui";
import { useEnhanceViewStore } from "@/stores/enhance-view";

/** Configurable useEnhance mock — the composer only reads this surface. */
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

vi.mock("@/lib/enhance/use-enhance", () => ({
  useEnhance: () => mockMutation,
}));

// TransformationDiff pulls in server actions (next/headers) — stub it with a
// marker that proves which submitted input the result view renders.
vi.mock("@/components/diff/TransformationDiff", () => ({
  TransformationDiff: ({ input }: { input: string }) => (
    <div data-testid="result-view">{input}</div>
  ),
}));
// The tray hits Supabase at mount — out of scope for composer tests.
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
  mockMutation.mutate.mockImplementation(
    (_req: unknown, opts?: { onSuccess?: (r: typeof FAKE_RESPONSE) => void }) => {
      opts?.onSuccess?.(FAKE_RESPONSE);
    },
  );
  useUIStore.setState({ editorDraft: "" });
  // The view store is a module singleton too — a result set by one test must
  // not leak into the next as a pre-mounted result view.
  useEnhanceViewStore.setState({ view: null });
  // jsdom implements neither — StreamingResult touches both on mount (the
  // UX-03 scroll-into-view), and the in-flight Clear test mounts it.
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("composer Clear (was RESET)", () => {
  it("ENHANCE is the only filled-Laser button in the composer", () => {
    const { container } = renderComposer();
    const laser = container.querySelectorAll(".btn-laser");
    expect(laser).toHaveLength(1);
    expect(laser[0]!.textContent).toMatch(/ENHANCE/);
    // Clear exists as a tertiary text action.
    expect(screen.getByRole("button", { name: /clear/i }).className).not.toMatch(
      /btn-laser/,
    );
  });

  it("clears a non-empty draft with an Undo toast that restores it", () => {
    renderComposer();
    fireEvent.change(screen.getByLabelText("Prompt input"), {
      target: { value: "my pasted draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect((screen.getByLabelText("Prompt input") as HTMLTextAreaElement).value).toBe("");
    expect(mockMutation.reset).toHaveBeenCalled();
    // getAllByRole, not getByRole: the composer now keeps a permanently
    // mounted (and normally empty) status region for the daily-cap notice —
    // a live region has to exist before its text lands to be announced. The
    // contract here is unchanged: the clear is announced through a live
    // region, not merely rendered.
    // Announced through the toast's permanent aria-live region (A11Y-004) —
    // present in the sr-only mirror and the visible card.
    expect(screen.getAllByText("Composer cleared").length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect((screen.getByLabelText("Prompt input") as HTMLTextAreaElement).value).toBe(
      "my pasted draft",
    );
  });

  it("Undo also restores a finished result, not just the draft", () => {
    renderComposer();
    fireEvent.change(screen.getByLabelText("Prompt input"), {
      target: { value: "enhance me" },
    });
    fireEvent.click(screen.getByRole("button", { name: /enhance/i }));
    expect(screen.getByTestId("result-view")).toHaveTextContent("enhance me");
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(screen.queryByTestId("result-view")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByTestId("result-view")).toHaveTextContent("enhance me");
  });

  it("asks for confirmation before clearing an in-flight run", () => {
    mockMutation.isPending = true;
    renderComposer();
    fireEvent.change(screen.getByLabelText("Prompt input"), {
      target: { value: "streaming…" },
    });
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    // Nothing cleared yet — the confirm sheet is up instead.
    expect((screen.getByLabelText("Prompt input") as HTMLTextAreaElement).value).toBe(
      "streaming…",
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Stop this run?");
    fireEvent.click(screen.getByRole("button", { name: "Stop & clear" }));
    expect(mockMutation.reset).toHaveBeenCalled();
    expect((screen.getByLabelText("Prompt input") as HTMLTextAreaElement).value).toBe("");
  });

  it("a finished result survives unmount and remount (navigation must not wash paid usage)", () => {
    // The bug this encodes: the result lived in component state, so visiting
    // Library or Profile unmounted the enhance route and silently destroyed a
    // result the user had already paid tokens for. The view store is what
    // keeps it alive across the round trip.
    const first = renderComposer();
    fireEvent.change(screen.getByLabelText("Prompt input"), {
      target: { value: "paid work" },
    });
    fireEvent.click(screen.getByRole("button", { name: /enhance/i }));
    expect(screen.getByTestId("result-view")).toHaveTextContent("paid work");
    first.unmount(); // navigate away…
    renderComposer(); // …and back
    expect(screen.getByTestId("result-view")).toHaveTextContent("paid work");
  });

  it("the result view renders the SUBMITTED input even after the draft changes (R8)", () => {
    renderComposer();
    fireEvent.change(screen.getByLabelText("Prompt input"), {
      target: { value: "original input" },
    });
    fireEvent.click(screen.getByRole("button", { name: /enhance/i }));
    fireEvent.change(screen.getByLabelText("Prompt input"), {
      target: { value: "edited afterwards" },
    });
    expect(screen.getByTestId("result-view")).toHaveTextContent("original input");
  });
});

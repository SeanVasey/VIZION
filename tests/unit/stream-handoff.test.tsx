import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { useUIStore } from "@/stores/ui";
import { useEnhanceViewStore } from "@/stores/enhance-view";

/**
 * The streaming→result handoff must never show a frame with neither surface
 * mounted. The hook clears `stream.active` in its finally block while the
 * result is only set in onSuccess, so `active` alone as the render condition
 * produces exactly that flash.
 */
const mockMutation = {
  isPending: false,
  isError: false as boolean,
  error: null as unknown,
  stream: {
    active: false,
    step: "generating",
    partialOutput: "half a prompt",
    tokenIn: 5,
    tokenOut: 9,
    costUsd: 0.0002,
  },
  mutate: vi.fn(),
  reset: vi.fn(),
};
vi.mock("@/lib/enhance/use-enhance", () => ({ useEnhance: () => mockMutation }));
vi.mock("@/components/diff/TransformationDiff", () => ({
  TransformationDiff: () => <div data-testid="result-view" />,
}));
vi.mock("@/components/media/AttachmentTray", () => ({ AttachmentTray: () => null }));

import { EnhanceComposer } from "@/components/editor/EnhanceComposer";

function renderComposer() {
  return render(
    <ToastProvider>
      <EnhanceComposer />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // The view store is a module singleton — a result set by one test must not
  // leak into the next as a pre-mounted result view.
  useEnhanceViewStore.setState({ view: null });
  mockMutation.isPending = false;
  mockMutation.stream.active = false;
  // Module-shared mock: the wait-state test empties this, so restore it.
  mockMutation.stream.partialOutput = "half a prompt";
  useUIStore.setState({ editorDraft: "" });
  // jsdom implements neither — StreamingResult touches both on mount (the
  // UX-03 scroll-into-view), same stub composer-error.test.tsx carries.
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("streaming → result handoff", () => {
  it("shows the streaming surface while the stream is active", () => {
    mockMutation.stream.active = true;
    mockMutation.isPending = true;
    renderComposer();
    expect(screen.getByLabelText("Enhancement in progress")).toBeTruthy();
  });

  it("keeps it mounted in the gap where active is false but no result exists", () => {
    // The exact one-frame state the hook passes through on every run.
    mockMutation.stream.active = false;
    mockMutation.isPending = true;
    renderComposer();
    expect(screen.getByLabelText("Enhancement in progress")).toBeTruthy();
    expect(screen.queryByTestId("result-view")).toBeNull();
  });

  it("shows neither surface at rest", () => {
    renderComposer();
    expect(screen.queryByLabelText("Enhancement in progress")).toBeNull();
    expect(screen.queryByTestId("result-view")).toBeNull();
  });

  it("shows a waiting skeleton before the first token, then the mono body", () => {
    mockMutation.stream.active = true;
    mockMutation.isPending = true;
    mockMutation.stream.partialOutput = "";
    renderComposer();
    const card = screen.getByLabelText("Enhancement in progress");
    expect(card.querySelector(".skeleton")).not.toBeNull();
    expect(card.querySelector(".mono")).toBeNull();
  });

  it("keeps the ⌁ ticker decorative while an sr-only phrase relates the counts (PRI-013)", () => {
    mockMutation.stream.active = true;
    mockMutation.isPending = true;
    renderComposer();
    const card = screen.getByLabelText("Enhancement in progress");
    // The visible glyph cluster is hidden from AT wholesale — hiding only
    // the arrow would announce "5 9 tok", two counts with no relationship.
    const visible = [...card.querySelectorAll('span[aria-hidden="true"]')].find(
      (s) => /⌁/.test(s.textContent ?? ""),
    );
    expect(visible).toBeTruthy();
    expect(visible!.textContent).toContain("→");
    // ...and the relationship survives as a readable phrase (mock: 5 in, 9 out).
    const phrase = [...card.querySelectorAll(".sr-only")].find((s) =>
      /tokens in/.test(s.textContent ?? ""),
    );
    expect(phrase).toBeTruthy();
    expect(phrase!.textContent).toContain("5");
    expect(phrase!.textContent).toContain("9");
  });
});

describe("ENHANCE pending state", () => {
  it("pairs a spinner with a label, so meaning never depends on motion", () => {
    mockMutation.isPending = true;
    const { container } = renderComposer();
    const button = screen
      .getAllByRole("button")
      .find((b) => /Enhancing/.test(b.textContent ?? ""));
    expect(button).toBeTruthy();
    // Reduced-motion freezes the ring; the text is what still communicates.
    expect(container.querySelector(".spinner")).not.toBeNull();
    expect(button!.textContent).toMatch(/Enhancing…/);
  });
});

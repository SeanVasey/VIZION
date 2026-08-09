import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { useUIStore } from "@/stores/ui";
import {
  DETENT_SPACING_PX,
  HOLD_MS,
} from "@/components/ui/use-hold-drag";

/**
 * The Target rail's budget hold-slider (ADR-0012).
 *
 * Two contracts carry this control. GATING: the hold gesture is live ONLY
 * while Auto routing is already on — a hold that silently enabled Auto would
 * be an invisible mode change, so plain-model mode must stay a pure tap
 * trigger with no axis claim. ORDER: the wire constant AUTO_PREFERENCES is
 * quality-first and test-pinned (models.test / the server contract), while
 * the slider displays cheapest-first so the fill grows with spend — the
 * display order is derived by reversal, and dragging the displayed track
 * must commit the PREFERENCE UNDER THE FINGER, not its mirror image.
 */
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
vi.mock("@/components/diff/TransformationDiff", () => ({
  TransformationDiff: () => null,
}));

import { EnhanceComposer } from "@/components/editor/EnhanceComposer";

function renderComposer() {
  return render(
    <ToastProvider>
      <EnhanceComposer />
    </ToastProvider>,
  );
}

const targetTrigger = () =>
  screen.getByRole("button", { name: /^Target model:/ });
const overlay = () =>
  document.querySelector<HTMLElement>("[data-hold-slider-overlay]");

const DOWN_X = 300;
function holdAndDrag(steps: number) {
  const trigger = targetTrigger();
  fireEvent.pointerDown(trigger, {
    pointerId: 1,
    clientX: DOWN_X,
    clientY: 400,
    button: 0,
  });
  act(() => {
    vi.advanceTimersByTime(HOLD_MS);
  });
  const x = DOWN_X + steps * DETENT_SPACING_PX;
  fireEvent.pointerMove(trigger, { pointerId: 1, clientX: x, clientY: 400 });
  fireEvent.pointerUp(trigger, { pointerId: 1, clientX: x, clientY: 400 });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  useUIStore.setState({
    editorDraft: "",
    activeMode: "polish",
    autoTarget: true,
    autoPreference: "balanced",
    targetModel: "opus_5",
    thinkingLevels: {},
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("budget hold-slider gating", () => {
  it("is inert while Auto routing is off — a hold expands nothing", () => {
    useUIStore.setState({ autoTarget: false });
    renderComposer();
    fireEvent.pointerDown(targetTrigger(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    expect(overlay()).toBeNull();
    fireEvent.pointerUp(targetTrigger(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
    });
    expect(useUIStore.getState().autoTarget).toBe(false);
  });

  it("offers the three presets cheapest-first while Auto is on", () => {
    renderComposer();
    fireEvent.pointerDown(targetTrigger(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    const dots = overlay()!.querySelectorAll("[data-detent-dot]");
    expect([...dots].map((d) => d.getAttribute("data-detent-dot"))).toEqual([
      "budget",
      "balanced",
      "quality",
    ]);
    fireEvent.pointerCancel(targetTrigger(), { pointerId: 1 });
  });
});

describe("budget hold-slider commits", () => {
  it("drags right to Quality and commits the preference under the finger", () => {
    renderComposer();
    // balanced (index 1) anchors under the finger; one step right = quality.
    holdAndDrag(1);
    const s = useUIStore.getState();
    expect(s.autoPreference).toBe("quality");
    // The slider tunes HOW Auto routes — never whether, and never the model.
    expect(s.autoTarget).toBe(true);
    expect(s.targetModel).toBe("opus_5");
  });

  it("drags left to Budget — the un-reversed mapping would land Quality", () => {
    renderComposer();
    holdAndDrag(-1);
    expect(useUIStore.getState().autoPreference).toBe("budget");
  });

  it("shows the Auto-qualified live label while dragging", () => {
    renderComposer();
    const trigger = targetTrigger();
    fireEvent.pointerDown(trigger, {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    expect(overlay()!.textContent).toContain("Auto · Balanced");
    fireEvent.pointerMove(trigger, {
      pointerId: 1,
      clientX: DOWN_X + DETENT_SPACING_PX,
      clientY: 400,
    });
    expect(overlay()!.textContent).toContain("Auto · Quality");
    fireEvent.pointerCancel(trigger, { pointerId: 1 });
  });

  it("reflects the committed preference on the pill at rest", () => {
    renderComposer();
    expect(targetTrigger()).toHaveTextContent("Auto · Balanced");
    holdAndDrag(1);
    expect(targetTrigger()).toHaveTextContent("Auto · Quality");
  });

  it("keeps a tap a tap — the Target sheet still opens", () => {
    renderComposer();
    fireEvent.click(targetTrigger());
    expect(
      screen.getByRole("dialog", { name: "Target model" }),
    ).toBeInTheDocument();
  });
});

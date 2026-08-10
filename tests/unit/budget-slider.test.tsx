import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { useUIStore } from "@/stores/ui";
import { DETENT_SPACING_PX, HOLD_MS, SLOP_PX } from "@/components/ui/use-hold-drag";

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

const targetTrigger = () => screen.getByRole("button", { name: /^Target model:/ });
const overlay = () => document.querySelector<HTMLElement>("[data-hold-slider-overlay]");

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
    expect(screen.getByRole("dialog", { name: "Target model" })).toBeInTheDocument();
  });
});

describe("the open sheet is inert to the budget slider", () => {
  /**
   * The sheet is a body portal but a React CHILD of the wrapper, so its
   * presses re-dispatch through the wrapper's handlers. Pre-guard, holding
   * the Auto card grew the capsule across the open sheet (z-85 over its
   * z-70), release committed a preference nobody chose, and the trailing-
   * click suppression ate the row's own tap (2026-08-10).
   */
  const openSheet = () => {
    fireEvent.click(targetTrigger());
    return screen.getByRole("dialog", { name: "Target model" });
  };
  const press = (el: Element, opts: Record<string, unknown> = {}) =>
    fireEvent.pointerDown(el, {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
      ...opts,
    });
  const lift = (el: Element, x = DOWN_X) =>
    fireEvent.pointerUp(el, { pointerId: 1, clientX: x, clientY: 400 });
  const hold = () =>
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });

  it("a hold on the Auto card expands nothing and commits nothing", () => {
    renderComposer();
    openSheet();
    const autoRow = screen.getByRole("radio", { name: /^Auto/ });
    press(autoRow);
    hold();
    expect(overlay()).toBeNull();
    lift(autoRow);
    expect(useUIStore.getState().autoPreference).toBe("balanced");
    // No suppression was armed, so the row's own tap still lands: Auto
    // stays on and the sheet closes.
    fireEvent.click(autoRow);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useUIStore.getState().autoTarget).toBe(true);
    // And the pill itself is not over-blocked: the real gesture still works.
    holdAndDrag(1);
    expect(useUIStore.getState().autoPreference).toBe("quality");
  });

  it("a press-and-slide on a segment stays a segment tap", () => {
    renderComposer();
    openSheet();
    const seg = screen.getByRole("button", { name: "Budget" });
    press(seg);
    fireEvent.pointerMove(seg, {
      pointerId: 1,
      clientX: DOWN_X + SLOP_PX + 4,
      clientY: 400,
    });
    expect(overlay()).toBeNull();
    lift(seg, DOWN_X + SLOP_PX + 4);
    expect(useUIStore.getState().autoPreference).toBe("balanced");
    fireEvent.click(seg);
    expect(useUIStore.getState().autoPreference).toBe("budget");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a hold on the scrim expands nothing, and its tap still closes", () => {
    renderComposer();
    const dialog = openSheet();
    // Side anchor ancestry: panel → centering column → fixed scrim.
    const scrim = dialog.parentElement!.parentElement as HTMLElement;
    press(scrim);
    hold();
    expect(overlay()).toBeNull();
    lift(scrim);
    expect(useUIStore.getState().autoPreference).toBe("balanced");
    fireEvent.click(scrim);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

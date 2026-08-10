import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DETENT_SPACING_PX, HOLD_MS } from "@/components/ui/use-hold-drag";
import { ToastProvider } from "@/components/ui/Toast";
import { useUIStore } from "@/stores/ui";
import type { EnhanceRequest } from "@/lib/enhance/use-enhance";

/**
 * The Thinking rail.
 *
 * The load-bearing test here is the FIRST one, and it is about apparent size.
 * Thinking sits directly under Target, so the two pills are read as a pair —
 * and while Thinking was a native `<select>` it could not join that pair:
 * globals.css floors `input, select, textarea` at 16px on iOS (Safari zooms a
 * focused sub-16px control and rarely zooms back), `!important`, which
 * out-specifies `text-sm`. The select's "Auto" therefore rendered 2px larger
 * than the Target pill's "Auto" one row above it — invisible in CI, because
 * the `-webkit-touch-callout` gate is iOS-only by construction (see
 * docs/runbooks/ios-verification.md), and unmissable on a phone.
 *
 * So the guard is structural, not visual: no replaced form control in the
 * rails, and ONE class string across both triggers.
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
// Mounted whenever a test puts the mutation in flight; its scroll-into-view
// effect wants matchMedia, which this jsdom setup doesn't provide — and the
// rail tests assert on the overlay, never on the streaming surface itself.
vi.mock("@/components/diff/StreamingResult", () => ({
  StreamingResult: () => null,
}));

import { EnhanceComposer } from "@/components/editor/EnhanceComposer";

function renderComposer() {
  return render(
    <ToastProvider>
      <EnhanceComposer />
    </ToastProvider>,
  );
}

function submit(text = "deepen this") {
  fireEvent.change(screen.getByLabelText("Prompt input"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /enhance/i }));
  return mockMutation.mutate.mock.calls.at(-1)![0] as EnhanceRequest;
}

const thinkingTrigger = () => screen.getByRole("button", { name: /^Thinking depth:/ });
const targetTrigger = () => screen.getByRole("button", { name: /^Target model:/ });

beforeEach(() => {
  vi.clearAllMocks();
  // Tests may put the mock mutation in flight; start each one at rest.
  mockMutation.isPending = false;
  mockMutation.stream.active = false;
  useUIStore.setState({
    editorDraft: "",
    activeMode: "polish",
    autoTarget: false,
    targetModel: "opus_5",
    thinkingLevels: {},
  });
});

describe("thinking rail sizing", () => {
  it("gives the Thinking and Target pills the same class string", () => {
    renderComposer();
    // Not "both contain text-sm": identical, so padding, min-height and hover
    // treatment cannot drift either. One constant, two consumers.
    expect(thinkingTrigger().className).toBe(targetTrigger().className);
    expect(thinkingTrigger().className).toContain("text-sm");
    expect(thinkingTrigger().className).toContain("min-h-[44px]");
  });

  it("uses no native form control in the composer rails (the iOS 16px floor)", () => {
    const { container } = renderComposer();
    // A `<select>` anywhere in the composer is the regression: the floor
    // targets `input, select, textarea`, and the rails must stay outside it.
    // (The prompt textarea is deliberately at/above 1rem-equivalent already —
    // it is the one control the floor is allowed to touch.)
    expect(container.querySelector("select")).toBeNull();
    expect(thinkingTrigger().tagName).toBe("BUTTON");
  });

  it("labels the rail without a `htmlFor` pointing at nothing", () => {
    renderComposer();
    // The caption is a span now; the trigger carries its own accessible name.
    expect(screen.getByText("Thinking").tagName).toBe("SPAN");
    expect(thinkingTrigger()).toHaveAccessibleName(/Thinking depth/);
  });

  it("wears the hold affordance at rest — decoration only, name untouched", () => {
    renderComposer();
    // This rail's slider is enabled unconditionally, so the hint always
    // shows. aria-hidden: the pill label stays the readout and the sheet
    // stays the accessible path (the affordance is for eyes only).
    const hint = thinkingTrigger().querySelector("[data-hold-hint]");
    expect(hint).not.toBeNull();
    expect(hint!.getAttribute("aria-hidden")).toBe("true");
    expect(thinkingTrigger()).toHaveAccessibleName(/^Thinking depth/);
  });
});

describe("thinking rail behaviour", () => {
  it("shows Auto until a depth is picked, then the chosen label", () => {
    const { rerender } = renderComposer();
    expect(thinkingTrigger()).toHaveTextContent("Auto");
    useUIStore.setState({ thinkingLevels: { opus_5: "xhigh" } });
    rerender(
      <ToastProvider>
        <EnhanceComposer />
      </ToastProvider>,
    );
    expect(thinkingTrigger()).toHaveTextContent("Extra High");
  });

  it("picks a depth from the sheet, stores it per target, and sends it", () => {
    renderComposer();
    fireEvent.click(thinkingTrigger());
    fireEvent.click(screen.getByRole("radio", { name: "High" }));
    expect(useUIStore.getState().thinkingLevels).toEqual({ opus_5: "high" });
    expect(submit().thinkingLevel).toBe("high");
  });

  it("clears back to Auto, which sends no level at all", () => {
    useUIStore.setState({ thinkingLevels: { opus_5: "max" } });
    renderComposer();
    fireEvent.click(thinkingTrigger());
    fireEvent.click(screen.getByRole("radio", { name: /^Auto/ }));
    expect(useUIStore.getState().thinkingLevels).toEqual({});
    expect(submit()).not.toHaveProperty("thinkingLevel");
  });

  it("fills the meter glyph to match each row's level", () => {
    renderComposer();
    fireEvent.click(thinkingTrigger());
    // Low = one strong bar, the other two faint. The label stays the
    // authoritative readout — the meter is its scannable echo.
    const low = screen.getByRole("radio", { name: "Low" });
    const lowBars = low.querySelectorAll("svg path");
    expect(lowBars).toHaveLength(3);
    expect([...lowBars].filter((p) => p.getAttribute("opacity") === "1")).toHaveLength(1);
    // Max breaks the meter (tall bar overshoots) and carries the ultra ink.
    const max = screen.getByRole("radio", { name: "Max" });
    expect(max.querySelector('svg path[d="M18 19V4"]')).not.toBeNull();
    expect(max.querySelector("svg")!.getAttribute("class")).toContain("text-ultra");
    // Auto keeps the neutral full meter in Silver — the original mark.
    const auto = screen.getByRole("radio", { name: /^Auto/ });
    expect(auto.querySelectorAll('svg path[opacity="1"]')).toHaveLength(3);
    expect(auto.querySelector("svg")!.getAttribute("class")).toContain("text-silver");
  });

  it("reflects the stored level in the trigger glyph, neutral under Auto", () => {
    useUIStore.setState({ thinkingLevels: { opus_5: "max" } });
    renderComposer();
    expect(thinkingTrigger().querySelector('svg path[d="M18 19V4"]')).not.toBeNull();
  });

  it("offers only the selected target's ladder, and no rail without one", () => {
    const { rerender } = renderComposer();
    fireEvent.click(thinkingTrigger());
    // Opus runs the five-step ladder; Minimal is Gemini's, not its.
    expect(screen.getByRole("radio", { name: "Max" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Minimal" })).toBeNull();

    // DeepSeek takes no per-request level — the whole rail goes away.
    useUIStore.setState({ targetModel: "deepseek_v4" });
    rerender(
      <ToastProvider>
        <EnhanceComposer />
      </ToastProvider>,
    );
    expect(screen.queryByText("Thinking")).toBeNull();
  });
});

describe("thinking rail hold-slider (ADR-0012)", () => {
  /** Drive the accelerator: press the pill, wait out the hold, drag by
   *  whole detents, release. Geometry derives from the down-x and the
   *  spacing constant, so jsdom's layoutless rects are irrelevant. */
  const DOWN_X = 300;
  function holdAndDrag(steps: number) {
    const trigger = thinkingTrigger();
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
  const overlay = () => document.querySelector<HTMLElement>("[data-hold-slider-overlay]");

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers [Auto, ...the target's ladder] as rising bars — six for Opus", () => {
    renderComposer();
    fireEvent.pointerDown(thinkingTrigger(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    // Bars, not dots: this capsule wears the DepthGlyph's rising-tick
    // vocabulary, which is also what tells it apart from the budget
    // capsule's equal dots one rail up.
    expect(overlay()!.querySelector("[data-detent-dot]")).toBeNull();
    const bars = overlay()!.querySelectorAll<HTMLElement>("[data-detent-bar]");
    expect([...bars].map((d) => d.getAttribute("data-detent-bar"))).toEqual([
      "auto",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    // Ascending: the ladder's shape is legible in the ticks themselves.
    const heights = [...bars].map((b) => parseFloat(b.style.height));
    expect(heights[0]).toBeLessThan(heights[heights.length - 1]!);
    expect([...heights].sort((a, b) => a - b)).toEqual(heights);
    fireEvent.pointerUp(thinkingTrigger(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
    });
  });

  it("adapts the detent count to the model — four for Grok, Minimal only for Gemini", () => {
    useUIStore.setState({ targetModel: "grok_4_5" });
    const { rerender } = renderComposer();
    fireEvent.pointerDown(thinkingTrigger(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    expect(overlay()!.querySelectorAll("[data-detent-bar]")).toHaveLength(4);
    fireEvent.pointerCancel(thinkingTrigger(), { pointerId: 1 });

    useUIStore.setState({ targetModel: "gemini_3_6_flash" });
    rerender(
      <ToastProvider>
        <EnhanceComposer />
      </ToastProvider>,
    );
    fireEvent.pointerDown(thinkingTrigger(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    expect(overlay()!.querySelector('[data-detent-bar="minimal"]')).not.toBeNull();
    fireEvent.pointerCancel(thinkingTrigger(), { pointerId: 1 });
  });

  it("drags to a depth, stores it per target, and sends it", () => {
    renderComposer();
    holdAndDrag(3); // Auto → low → medium → high
    expect(useUIStore.getState().thinkingLevels).toEqual({ opus_5: "high" });
    vi.useRealTimers(); // submit() renders a toast timer; real time is fine now
    expect(submit().thinkingLevel).toBe("high");
  });

  it("drags fully left back to Auto, which sends no level at all", () => {
    useUIStore.setState({ thinkingLevels: { opus_5: "max" } });
    renderComposer();
    // The selected detent (max, index 5) anchors under the finger — five
    // steps left lands on Auto.
    holdAndDrag(-5);
    expect(useUIStore.getState().thinkingLevels).toEqual({});
    vi.useRealTimers();
    expect(submit()).not.toHaveProperty("thinkingLevel");
  });

  it("ramps the fill tone with the level and shows the model-qualified label", () => {
    renderComposer();
    const trigger = thinkingTrigger();
    fireEvent.pointerDown(trigger, {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    const fill = () => overlay()!.querySelector("[data-tone]")!;
    expect(fill().getAttribute("data-tone")).toBe("faint"); // Auto
    fireEvent.pointerMove(trigger, {
      pointerId: 1,
      clientX: DOWN_X + DETENT_SPACING_PX,
      clientY: 400,
    });
    expect(fill().getAttribute("data-tone")).toBe("silver"); // low
    fireEvent.pointerMove(trigger, {
      pointerId: 1,
      clientX: DOWN_X + 3 * DETENT_SPACING_PX,
      clientY: 400,
    });
    expect(fill().getAttribute("data-tone")).toBe("laser"); // high
    fireEvent.pointerMove(trigger, {
      pointerId: 1,
      clientX: DOWN_X + 5 * DETENT_SPACING_PX,
      clientY: 400,
    });
    expect(fill().getAttribute("data-tone")).toBe("ultra"); // max
    // Chip says the level alone — "Opus 5" is already on the Target rail
    // and in the commit announcement; the readout must not stack the model
    // name beside itself (owner de-duplication, 2026-08-10).
    expect(overlay()!.textContent).toContain("Max");
    expect(overlay()!.textContent).not.toContain("Opus 5");
    fireEvent.pointerUp(trigger, {
      pointerId: 1,
      clientX: DOWN_X + 5 * DETENT_SPACING_PX,
      clientY: 400,
    });
    expect(useUIStore.getState().thinkingLevels).toEqual({ opus_5: "max" });
  });

  it("keeps a tap a tap — the sheet still opens after the wrapper landed", () => {
    renderComposer();
    fireEvent.click(thinkingTrigger());
    expect(screen.getByRole("radio", { name: "Max" })).toBeInTheDocument();
  });

  it("ships the gesture dim-only while a run is in flight — the stream cannot pause", () => {
    // The rails deliberately stay enabled mid-run (dialing the NEXT run),
    // and the streaming surface keeps repainting beneath the overlay — a
    // moving backdrop under a backdrop-filter re-filters every frame, the
    // 2026-08-09 bloom mechanism. Content can't honestly pause the way the
    // idle ornaments do, so the composer declares the backdrop dynamic and
    // the blur stands down for that gesture (Codex review, eighth pass).
    mockMutation.isPending = true;
    renderComposer();
    fireEvent.pointerDown(thinkingTrigger(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    expect(overlay()).not.toBeNull();
    expect(document.querySelector("[data-hold-slider-blur]")).toBeNull();
    expect(document.querySelector("[data-hold-slider-scrim]")).not.toBeNull();
    // The gesture itself is untouched — drag one detent, release, commit.
    fireEvent.pointerMove(thinkingTrigger(), {
      pointerId: 1,
      clientX: DOWN_X + DETENT_SPACING_PX,
      clientY: 400,
    });
    fireEvent.pointerUp(thinkingTrigger(), {
      pointerId: 1,
      clientX: DOWN_X + DETENT_SPACING_PX,
      clientY: 400,
    });
    expect(useUIStore.getState().thinkingLevels).toEqual({ opus_5: "low" });
  });

  it("stays out of its own open sheet — a held row is a tap, not a drag", () => {
    // This rail's slider is enabled unconditionally, so pre-guard it was the
    // worse half of the 2026-08-10 defect: the sheet is a body portal but a
    // React child of the wrapper, so holding a depth row re-dispatched into
    // the gesture — capsule over the open sheet, phantom commit, row tap
    // eaten by the trailing-click suppression.
    renderComposer();
    fireEvent.click(thinkingTrigger());
    const high = screen.getByRole("radio", { name: "High" });
    fireEvent.pointerDown(high, {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    expect(overlay()).toBeNull();
    fireEvent.pointerUp(high, { pointerId: 1, clientX: DOWN_X, clientY: 400 });
    expect(useUIStore.getState().thinkingLevels).toEqual({});
    // The row's own tap still lands and closes the sheet.
    fireEvent.click(high);
    expect(useUIStore.getState().thinkingLevels).toEqual({ opus_5: "high" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

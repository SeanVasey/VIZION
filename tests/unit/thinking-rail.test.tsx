import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DETENT_SPACING_PX, HOLD_MS } from "@/components/ui/use-hold-drag";
import { ToastProvider } from "@/components/ui/Toast";
import { useUIStore } from "@/stores/ui";
import type { EnhanceRequest } from "@/lib/enhance/use-enhance";

/**
 * The Thinking rail — a dial, not a dropdown (ADR-0014).
 *
 * Two contracts. The older one is about APPARENT SIZE: Thinking sits directly
 * under Target, so the two pills are read as a pair — and while Thinking was
 * a native `<select>` it could not join that pair, because globals.css floors
 * `input, select, textarea` at 16px on iOS (Safari zooms a focused sub-16px
 * control and rarely zooms back), `!important`, which out-specifies
 * `text-sm`. The select's "Auto" therefore rendered 2px larger than the
 * Target pill's "Auto" one row above it — invisible in CI, because the
 * `-webkit-touch-callout` gate is iOS-only by construction (see
 * docs/runbooks/ios-verification.md), and unmissable on a phone. That guard
 * is structural, not visual: no replaced form control in the rails, and ONE
 * class string across both triggers.
 *
 * The newer one is about WHAT THE CONTROL IS. Owner direction retired the
 * depth sheet: the pill is now the slider itself — `role="slider"`, no
 * chevron, arrows step the ladder, a tap opens the capsule over the pill and
 * leaves it up. So the tests that used to reach a value through
 * `getByRole("radio")` reach it three ways instead, and each way is a
 * separate promise: the KEYBOARD ladder (which is what let the sheet go
 * without losing WCAG 2.1.1), the LATCHED tap-then-tap (WCAG 2.5.7's
 * no-dragging route), and the drag accelerator.
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

const thinkingTrigger = () => screen.getByRole("slider", { name: "Thinking depth" });
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
    // Default the how-to line OUT of the way; its own block turns it back on.
    dialTipSeen: true,
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
    // `input[type=range]` is the same trap wearing this control's name —
    // the dial is a BUTTON with slider semantics for exactly that reason.
    // (The prompt textarea is deliberately at/above 1rem-equivalent already —
    // it is the one control the floor is allowed to touch.)
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector("input[type=range]")).toBeNull();
    expect(thinkingTrigger().tagName).toBe("BUTTON");
  });

  it("wears no disclosure chevron — it opens a slider, not a menu", () => {
    renderComposer();
    // Owner direction: a control only looks like a dropdown if it IS one.
    // Target keeps its chevron (sixteen models behind a sheet); Thinking
    // trades it for the grip, and the two marks are how the pair stays
    // legible as two different kinds of control at the same size.
    expect(thinkingTrigger().querySelector("[data-hold-hint]")).not.toBeNull();
    expect(thinkingTrigger().getAttribute("aria-haspopup")).toBeNull();
    expect(targetTrigger().getAttribute("aria-haspopup")).toBe("dialog");
    expect(targetTrigger().querySelector("[data-hold-hint]")).toBeNull();
  });

  it("declares the ARIA slider contract its keyboard ladder implements", () => {
    useUIStore.setState({ thinkingLevels: { opus_5: "high" } });
    renderComposer();
    const dial = thinkingTrigger();
    // [Auto, low, medium, high, xhigh, max] — Auto is index 0, so max is the
    // LADDER length, not the ladder length plus one.
    expect(dial.getAttribute("aria-valuemin")).toBe("0");
    expect(dial.getAttribute("aria-valuemax")).toBe("5");
    expect(dial.getAttribute("aria-valuenow")).toBe("3");
    // The NAME of the value, never its ordinal.
    expect(dial.getAttribute("aria-valuetext")).toBe("High");
  });

  it("labels the rail without a `htmlFor` pointing at nothing", () => {
    renderComposer();
    // The caption is a span; the dial carries its own accessible name.
    expect(screen.getByText("Thinking").tagName).toBe("SPAN");
    expect(thinkingTrigger()).toHaveAccessibleName("Thinking depth");
  });

  it("wears the hold affordance at rest — decoration only, name untouched", () => {
    renderComposer();
    // This rail's slider is enabled unconditionally, so the mini-track always
    // shows. aria-hidden: the value is carried by aria-valuetext, and the
    // mini-track is for eyes only.
    const hint = thinkingTrigger().querySelector("[data-hold-hint]");
    expect(hint).not.toBeNull();
    expect(hint!.getAttribute("aria-hidden")).toBe("true");
    expect(thinkingTrigger()).toHaveAccessibleName("Thinking depth");
  });

  it("shows the resting mini-track at the level the pill names", () => {
    // The affordance is a scale model of the capsule, so it has to be wired
    // to the SAME index the ARIA contract publishes — a hint that lagged the
    // label would be a second, wrong readout rather than a picture of the
    // first one.
    useUIStore.setState({ thinkingLevels: { opus_5: "high" } });
    renderComposer();
    const thumbX = () =>
      Number.parseFloat(
        thinkingTrigger().querySelector<HTMLElement>("[data-hold-hint-thumb]")!.style
          .left,
      );
    expect(thinkingTrigger().getAttribute("aria-valuenow")).toBe("3");
    const atHigh = thumbX();

    act(() => useUIStore.setState({ thinkingLevels: { opus_5: "max" } }));
    expect(thinkingTrigger().getAttribute("aria-valuenow")).toBe("5");
    expect(thumbX()).toBeGreaterThan(atHigh);

    act(() => useUIStore.setState({ thinkingLevels: {} }));
    expect(thinkingTrigger().getAttribute("aria-valuenow")).toBe("0");
    expect(thumbX()).toBeLessThan(atHigh);
  });

  it("retires the press-and-hold pulse with the coach line, not separately", () => {
    // Two hints for one lesson: the written sentence under the rail and the
    // ring pulsing off the mini thumb. They read the same dialTipSeen flag,
    // so learning the control silences both — a pulse that outlived the
    // sentence would be a hint for something already learned.
    useUIStore.setState({ dialTipSeen: false });
    renderComposer();
    const thumb = () =>
      thinkingTrigger().querySelector<HTMLElement>("[data-hold-hint-thumb]")!;
    expect(thumb().className).toContain("hold-hint-pulse");
    expect(document.querySelector("[data-dial-coach-tip]")).not.toBeNull();

    act(() => useUIStore.setState({ dialTipSeen: true }));
    expect(thumb().className).not.toContain("hold-hint-pulse");
    expect(document.querySelector("[data-dial-coach-tip]")).toBeNull();
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

  it("steps the ladder on the arrow keys, stores it per target, and sends it", () => {
    // The keyboard path is what retired the sheet: the whole ladder is on
    // the control, so reaching a value never requires opening anything.
    renderComposer();
    fireEvent.keyDown(thinkingTrigger(), { key: "ArrowRight" });
    expect(useUIStore.getState().thinkingLevels).toEqual({ opus_5: "low" });
    fireEvent.keyDown(thinkingTrigger(), { key: "ArrowRight" });
    fireEvent.keyDown(thinkingTrigger(), { key: "ArrowRight" });
    expect(useUIStore.getState().thinkingLevels).toEqual({ opus_5: "high" });
    expect(submit().thinkingLevel).toBe("high");
  });

  it("jumps the ends with Home/End and clamps past them", () => {
    renderComposer();
    fireEvent.keyDown(thinkingTrigger(), { key: "End" });
    expect(useUIStore.getState().thinkingLevels).toEqual({ opus_5: "max" });
    // Already at the top: another step is a no-op, not an overflow.
    fireEvent.keyDown(thinkingTrigger(), { key: "ArrowRight" });
    expect(useUIStore.getState().thinkingLevels).toEqual({ opus_5: "max" });
    fireEvent.keyDown(thinkingTrigger(), { key: "Home" });
    expect(useUIStore.getState().thinkingLevels).toEqual({});
  });

  it("clears back to Auto, which sends no level at all", () => {
    useUIStore.setState({ thinkingLevels: { opus_5: "low" } });
    renderComposer();
    fireEvent.keyDown(thinkingTrigger(), { key: "ArrowLeft" });
    expect(useUIStore.getState().thinkingLevels).toEqual({});
    expect(submit()).not.toHaveProperty("thinkingLevel");
  });

  it("reflects the stored level in the dial glyph and its ink", () => {
    useUIStore.setState({ thinkingLevels: { opus_5: "max" } });
    const { rerender } = renderComposer();
    // Max breaks the meter (its tall bar overshoots) and carries ultra ink.
    expect(thinkingTrigger().querySelector('svg path[d="M18 19V4"]')).not.toBeNull();
    expect(thinkingTrigger().querySelector("svg")!.getAttribute("class")).toContain(
      "text-ultra",
    );
    // The LABEL is colour-coded too, so the tier reads at rest without
    // opening the capsule — the ultra tier in ultra ink…
    expect(screen.getByText("Max").className).toContain("text-ultra");

    // …the middle of the ladder in the text-safe accent (never raw laser —
    // laser-as-text is 1.09:1 on light, guardrail §6)…
    useUIStore.setState({ thinkingLevels: { opus_5: "high" } });
    rerender(
      <ToastProvider>
        <EnhanceComposer />
      </ToastProvider>,
    );
    expect(screen.getByText("High").className).toContain("text-accent");

    // …and Auto keeps the neutral full meter in Silver, the original mark.
    useUIStore.setState({ thinkingLevels: {} });
    rerender(
      <ToastProvider>
        <EnhanceComposer />
      </ToastProvider>,
    );
    expect(thinkingTrigger().querySelectorAll('svg path[opacity="1"]')).toHaveLength(3);
    expect(thinkingTrigger().querySelector("svg")!.getAttribute("class")).toContain(
      "text-silver",
    );
    expect(screen.getByText("Auto").className).toContain("text-silver");
  });

  it("offers only the selected target's ladder, and no rail without one", () => {
    const { rerender } = renderComposer();
    // Opus runs the five-step ladder, so End lands on Max…
    fireEvent.keyDown(thinkingTrigger(), { key: "End" });
    expect(thinkingTrigger()).toHaveTextContent("Max");
    expect(thinkingTrigger().getAttribute("aria-valuemax")).toBe("5");

    // …while Gemini's four-step ladder tops out at High and starts at
    // Minimal, which is not on Opus's ladder at all.
    useUIStore.setState({ targetModel: "gemini_3_6_flash" });
    rerender(
      <ToastProvider>
        <EnhanceComposer />
      </ToastProvider>,
    );
    expect(thinkingTrigger().getAttribute("aria-valuemax")).toBe("4");
    fireEvent.keyDown(thinkingTrigger(), { key: "End" });
    expect(thinkingTrigger()).toHaveTextContent("High");
    fireEvent.keyDown(thinkingTrigger(), { key: "Home" });
    fireEvent.keyDown(thinkingTrigger(), { key: "ArrowRight" });
    expect(thinkingTrigger()).toHaveTextContent("Minimal");

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

  it("latches the capsule on a plain tap — and a tap on the track picks", () => {
    // The no-dragging route (WCAG 2.5.7) now that no sheet sits behind the
    // pill: tap to open, tap the stop you want. The opening pointer is gone
    // by the time the track is up, so the track — not the wrapper — owns
    // the second tap.
    renderComposer();
    fireEvent.pointerDown(thinkingTrigger(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    fireEvent.pointerUp(thinkingTrigger(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
    });
    // No hold, no drag, no sheet — the capsule is simply up and stays up.
    expect(overlay()).not.toBeNull();
    expect(overlay()!.dataset.holdSliderPhase).toBe("latched");
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(overlay()).not.toBeNull();

    // Tap a stop directly. Latched mapping is ABSOLUTE — the finger is on
    // the track itself, so there is no press-point offset to preserve.
    const track = overlay()!;
    const x = Number(
      overlay()!
        .querySelector<HTMLElement>('[data-detent-bar="high"]')!
        .style.left.replace("px", ""),
    );
    const left = Number(String(track.style.left).replace("px", ""));
    fireEvent.pointerDown(track, { pointerId: 2, clientX: left + x, clientY: 400 });
    fireEvent.pointerUp(track, { pointerId: 2, clientX: left + x, clientY: 400 });
    expect(useUIStore.getState().thinkingLevels).toEqual({ opus_5: "high" });
    expect(overlay()).toBeNull();
  });

  it("dismisses a latched capsule on an outside tap, committing nothing", () => {
    useUIStore.setState({ thinkingLevels: { opus_5: "low" } });
    renderComposer();
    fireEvent.pointerDown(thinkingTrigger(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    fireEvent.pointerUp(thinkingTrigger(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
    });
    expect(overlay()).not.toBeNull();
    const scrim = document.querySelector("[data-hold-slider-scrim]")!;
    fireEvent.pointerDown(scrim, { pointerId: 2, clientX: 10, clientY: 10 });
    expect(overlay()).toBeNull();
    // Unchanged — dismiss is not a commit.
    expect(useUIStore.getState().thinkingLevels).toEqual({ opus_5: "low" });
    // …and the claim is released, so the next tap opens a fresh capsule.
    fireEvent.pointerDown(thinkingTrigger(), {
      pointerId: 3,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    fireEvent.pointerUp(thinkingTrigger(), {
      pointerId: 3,
      clientX: DOWN_X,
      clientY: 400,
    });
    expect(overlay()).not.toBeNull();
  });

  it("drives a latched capsule from the keyboard, and reverts on Escape", () => {
    renderComposer();
    fireEvent.pointerDown(thinkingTrigger(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    fireEvent.pointerUp(thinkingTrigger(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
    });
    // Arrows drive the OPEN track (use-hold-drag claims them at window
    // capture), so the dial's own rest-time handler never sees them and the
    // value is not committed until Enter.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(overlay()!.textContent).toContain("Medium");
    expect(useUIStore.getState().thinkingLevels).toEqual({});
    fireEvent.keyDown(window, { key: "Enter" });
    expect(overlay()).toBeNull();
    expect(useUIStore.getState().thinkingLevels).toEqual({ opus_5: "medium" });

    // Escape reverts instead.
    fireEvent.pointerDown(thinkingTrigger(), {
      pointerId: 2,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    fireEvent.pointerUp(thinkingTrigger(), {
      pointerId: 2,
      clientX: DOWN_X,
      clientY: 400,
    });
    fireEvent.keyDown(window, { key: "End" });
    expect(overlay()!.textContent).toContain("Max");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(overlay()).toBeNull();
    expect(useUIStore.getState().thinkingLevels).toEqual({ opus_5: "medium" });
  });

  it("marks the top stop as an event — burst, surge and its cost caption", () => {
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
    // Below the top: no burst, no surge, no caption — they would be noise on
    // a stop that costs nothing out of the ordinary.
    fireEvent.pointerMove(thinkingTrigger(), {
      pointerId: 1,
      clientX: DOWN_X + 3 * DETENT_SPACING_PX,
      clientY: 400,
    });
    expect(overlay()!.querySelector("[data-hold-slider-burst]")).toBeNull();
    expect(overlay()!.querySelector("[data-hold-slider-surge]")).toBeNull();
    expect(overlay()!.querySelector("[data-hold-slider-caption]")).toBeNull();

    fireEvent.pointerMove(thinkingTrigger(), {
      pointerId: 1,
      clientX: DOWN_X + 5 * DETENT_SPACING_PX,
      clientY: 400,
    });
    expect(overlay()!.querySelector("[data-hold-slider-burst]")).not.toBeNull();
    expect(overlay()!.querySelector("[data-hold-slider-surge]")).not.toBeNull();
    // The caption states the COST, which is the one thing "Max" does not.
    expect(overlay()!.querySelector("[data-hold-slider-caption]")!.textContent).toMatch(
      /highest cost/i,
    );
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

  it("shields every other control while a capsule is up — no sheet under the gesture", () => {
    // On hybrid-input devices a second pointer's synthesized click lands
    // mid-drag; pre-fix it opened the Target sheet (z-70) under the live
    // capsule (z-85) — the sheet-mid-gesture state the guards exist to
    // prevent (Codex review, ninth pass).
    //
    // The Target pill is no longer wrapped in a slider of its own (ADR-0014
    // moved the budget dial into its sheet), so the click-consumption that
    // used to ride on ITS wrapper is gone with it. What holds the line is
    // the pair that always did the physical work: a viewport-covering,
    // pointer-INTERACTIVE shield above the sheet tier, so a second pointer
    // never reaches the pill to synthesize a click in the first place — and
    // the window key-swallow for the one channel hit-testing cannot cover.
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
    const shield = document.querySelector<HTMLElement>("[data-hold-slider-scrim]")!;
    expect(shield.className).toContain("pointer-events-auto");
    expect(shield.className).toContain("fixed inset-0");
    expect(shield.className).toContain("z-[84]");
    // Keyboard is its own channel: Enter on a focused background trigger
    // activated it and opened the sheet (fourteenth pass).
    targetTrigger().focus();
    fireEvent.keyDown(targetTrigger(), { key: "Enter" });
    fireEvent.keyUp(targetTrigger(), { key: "Enter" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.pointerUp(thinkingTrigger(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
    });
    // Shield gone with the capsule — the Target pill works normally again.
    expect(document.querySelector("[data-hold-slider-scrim]")).toBeNull();
    fireEvent.click(targetTrigger());
    expect(screen.getByRole("dialog", { name: "Target model" })).toBeInTheDocument();
  });

  it("never mounts the capsule over a sheet a second device opened mid-press", () => {
    // The template button is a NON-wrapped trigger: during the thinking
    // pill's 300ms pre-hold window (shield not yet mounted, claim only
    // consulted by wrapped pills) a second device's click opens the
    // template sheet — and pre-fix the timer then drew the capsule over it
    // (thirteenth pass). Activation now probes role="dialog" and stands
    // down; the sheet stays open and untouched.
    renderComposer();
    fireEvent.pointerDown(thinkingTrigger(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: /try a template/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    expect(overlay()).toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.pointerUp(thinkingTrigger(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
    });
    expect(useUIStore.getState().thinkingLevels).toEqual({});
  });

  it("stays out of a foreign open sheet — a held row there is a tap, not a drag", () => {
    // The 2026-08-10 defect in its surviving form. The Thinking dial has no
    // sheet of its own any more, so the portal-bubbling half is structurally
    // gone; what remains is the admission rule itself — a gesture may only
    // begin in the wrapper's own DOM subtree — and the activation stand-down
    // over a dialog that does not contain the trigger. A hold on a model row
    // in the Target sheet must be exactly a tap.
    renderComposer();
    fireEvent.click(targetTrigger());
    const row = screen.getByRole("radio", { name: "Fable 5" });
    fireEvent.pointerDown(row, {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    expect(overlay()).toBeNull();
    fireEvent.pointerUp(row, { pointerId: 1, clientX: DOWN_X, clientY: 400 });
    // The row's own tap still lands and closes the sheet.
    fireEvent.click(row);
    expect(useUIStore.getState().targetModel).toBe("fable_5");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the dials' how-to line (ADR-0014)", () => {
  const tip = () => document.querySelector("[data-dial-coach-tip]");
  /** Same known down-x the hold-slider block uses; geometry derives from it
   *  and the spacing constant, so jsdom's layoutless rects are irrelevant. */
  const DOWN_X = 300;

  beforeEach(() => {
    vi.useFakeTimers();
    useUIStore.setState({ dialTipSeen: false });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("explains the gesture the grip cannot", () => {
    // ADR-0014 traded a legible lie (a chevron over no dropdown) for an
    // invisible truth (a grip over a slider). This line is what pays that
    // debt, and it names BOTH ways in — tap and hold — because the tap is
    // the one a user will find by accident and the hold is the one worth
    // knowing.
    renderComposer();
    expect(tip()).not.toBeNull();
    expect(tip()!.textContent).toMatch(/tap/i);
    expect(tip()!.textContent).toMatch(/hold/i);
  });

  it("retires itself the first time a dial is actually used", () => {
    // A hint that has been proven unnecessary should not survive to be read
    // twice. Any commit counts — this one comes through the capsule.
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
    expect(useUIStore.getState().dialTipSeen).toBe(true);
    expect(tip()).toBeNull();
  });

  it("retires on a keyboard step too — the ladder is a use like any other", () => {
    renderComposer();
    fireEvent.keyDown(thinkingTrigger(), { key: "ArrowRight" });
    expect(useUIStore.getState().dialTipSeen).toBe(true);
    expect(tip()).toBeNull();
  });

  it("keeps its dismissal's hit area off the dial above it", () => {
    // `tap-44` centres a 44px pseudo-element, so on a ~15px line it overhangs
    // ~14px each way — and this row sits 4px under the Thinking rail with the
    // button right-aligned, directly beneath the dial. The overhang reached
    // into the dial's lower edge, right where the grip is, so tapping to open
    // the slider dismissed the tip instead (Codex review, PR #109). The row
    // now reserves the button's own target height and the button centres
    // inside it, which contains the pseudo within the row.
    renderComposer();
    const tipRow = tip() as HTMLElement;
    expect(tipRow.className).toContain("min-h-[44px]");
    expect(screen.getByRole("button", { name: "Got it" }).className).toContain(
      "self-center",
    );
    // The glyph still rides the first text line — the reserved height is the
    // button's business, not the copy's.
    expect(tipRow.className).toContain("items-start");
  });

  it("gives its dismissal a real 44px target, not a 39px one", () => {
    // The floor applies to the TAP TARGET, not the ink — the label is one
    // small word by design. `tap-44` is the repo's extender for exactly that
    // (a pseudo-element sized max(100%, 44px) on both axes). The first cut
    // used py-3 plus a negative margin, which measured ~39px on an 11px line
    // and set no minimum width at all (Codex review, PR #109).
    renderComposer();
    const dismiss = screen.getByRole("button", { name: "Got it" });
    expect(dismiss.className).toContain("tap-44");
    expect(dismiss.className).not.toContain("-my-3");
  });

  it("dismisses explicitly, and stays gone", () => {
    const { rerender } = renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(useUIStore.getState().dialTipSeen).toBe(true);
    expect(tip()).toBeNull();
    rerender(
      <ToastProvider>
        <EnhanceComposer />
      </ToastProvider>,
    );
    expect(tip()).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

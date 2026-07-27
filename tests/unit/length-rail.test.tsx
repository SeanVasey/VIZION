import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { useUIStore } from "@/stores/ui";
import {
  LENGTHS,
  LENGTH_INSTRUCTIONS,
  hasLengthControl,
  isLengthId,
  lengthOptions,
} from "@/lib/enhance/lengths";
import { buildSystemPrompt } from "@/lib/providers/formatters";
import { MODES } from "@/lib/constants";
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

function submit() {
  fireEvent.change(screen.getByLabelText("Prompt input"), {
    target: { value: "make this the right size" },
  });
  fireEvent.click(screen.getByRole("button", { name: /enhance/i }));
  return mockMutation.mutate.mock.calls.at(-1)![0] as EnhanceRequest;
}

const DIAL_MODES = ["condense", "expand"] as const;
const NO_DIAL_MODES = MODES.map((m) => m.id).filter(
  (m) => !(DIAL_MODES as readonly string[]).includes(m),
);

beforeEach(() => {
  vi.clearAllMocks();
  useUIStore.setState({
    editorDraft: "",
    activeMode: "condense",
    lengthByMode: {},
    reformatFormat: null,
    autoTarget: false,
    targetModel: "opus_5",
  });
});

describe("length catalogue", () => {
  it.each(DIAL_MODES)("gives %s three labelled options", (mode) => {
    const opts = lengthOptions(mode)!;
    expect(opts.map((o) => o.id)).toEqual([...LENGTHS]);
    for (const o of opts) expect(o.label.trim()).toBeTruthy();
  });

  it.each(NO_DIAL_MODES)("gives %s no dial at all", (mode) => {
    expect(lengthOptions(mode)).toBeNull();
    expect(hasLengthControl(mode)).toBe(false);
  });

  it("labels the two modes differently — the ends mean opposite things", () => {
    // "Short" on Condense is the gentlest trim; on Expand it is the smallest
    // addition. Sharing one word set would misdescribe one of them.
    const condense = lengthOptions("condense")!.map((o) => o.label);
    const expand = lengthOptions("expand")!.map((o) => o.label);
    expect(condense).not.toEqual(expand);
    expect(new Set([...condense, ...expand]).size).toBe(6);
  });

  it("has an instruction for every mode/length pair it offers", () => {
    for (const mode of DIAL_MODES) {
      for (const id of LENGTHS) {
        expect(LENGTH_INSTRUCTIONS[mode]?.[id]?.trim()).toBeTruthy();
      }
    }
  });

  it("guards the wire", () => {
    for (const id of LENGTHS) expect(isLengthId(id)).toBe(true);
    for (const bad of ["Short", "tiny", "", null, 3, {}]) {
      expect(isLengthId(bad)).toBe(false);
    }
  });
});

describe("length instructions in the system prompt", () => {
  it.each(DIAL_MODES)("appends the chosen depth for %s", (mode) => {
    const prompt = buildSystemPrompt({ mode, target: "opus_5", length: "long" });
    expect(prompt).toContain(LENGTH_INSTRUCTIONS[mode]!.long);
  });

  it.each(NO_DIAL_MODES)("ignores a length sent with %s", (mode) => {
    // Keyed by mode, so a length on a dial-less mode finds nothing to append.
    const withKnob = buildSystemPrompt({ mode, target: "opus_5", length: "long" });
    const without = buildSystemPrompt({ mode, target: "opus_5" });
    expect(withKnob).toBe(without);
  });

  it("does not cross the two modes' instructions", () => {
    const prompt = buildSystemPrompt({
      mode: "condense",
      target: "opus_5",
      length: "long",
    });
    expect(prompt).not.toContain(LENGTH_INSTRUCTIONS.expand!.long);
  });
});

describe("length rail", () => {
  it.each(DIAL_MODES)("appears in %s mode", (mode) => {
    useUIStore.setState({ activeMode: mode });
    renderComposer();
    expect(screen.getByRole("group", { name: "Length" })).toBeTruthy();
  });

  it.each(NO_DIAL_MODES)("is hidden in %s mode", (mode) => {
    useUIStore.setState({ activeMode: mode });
    renderComposer();
    expect(screen.queryByRole("group", { name: "Length" })).toBeNull();
  });

  it("shows the mode's own words", () => {
    renderComposer();
    expect(screen.getByRole("button", { name: "Tight" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Focused" })).toBeNull();
  });

  it("sends nothing until a depth is picked", () => {
    renderComposer();
    expect(submit().length).toBeUndefined();
  });

  it("sends the picked depth", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "Essential" }));
    expect(submit().length).toBe("long");
  });

  it("keeps a separate dial per mode", () => {
    // Condense at Essential must not make Expand Comprehensive — the modes
    // are opposites, so one shared value would be actively wrong.
    useUIStore.setState({ lengthByMode: { condense: "long" } });
    renderComposer();
    expect(useUIStore.getState().lengthByMode.expand).toBeUndefined();
    expect(submit().length).toBe("long");
  });

  it("clears when the active depth is re-picked", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "Balanced" }));
    expect(useUIStore.getState().lengthByMode.condense).toBe("medium");
    fireEvent.click(screen.getByRole("button", { name: "Balanced" }));
    expect(useUIStore.getState().lengthByMode.condense).toBeUndefined();
  });

  it("never leaks a stored depth into a mode without a dial", () => {
    useUIStore.setState({
      lengthByMode: { condense: "long" },
      activeMode: "polish",
    });
    renderComposer();
    expect(submit().length).toBeUndefined();
  });
});

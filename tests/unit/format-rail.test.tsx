import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { useUIStore } from "@/stores/ui";
import {
  FORMATS,
  FORMAT_INSTRUCTIONS,
  FORMAT_LABEL,
  isFormatId,
} from "@/lib/enhance/formats";
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

function submit(text = "restructure me") {
  fireEvent.change(screen.getByLabelText("Prompt input"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /enhance/i }));
  return mockMutation.mutate.mock.calls.at(-1)![0] as EnhanceRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  useUIStore.setState({
    editorDraft: "",
    activeMode: "reformat",
    reformatFormat: null,
    autoTarget: false,
    targetModel: "opus_5",
  });
});

describe("format catalogue", () => {
  it("has a label and an instruction for every format", () => {
    for (const id of FORMATS) {
      expect(FORMAT_LABEL[id]?.trim()).toBeTruthy();
      expect(FORMAT_INSTRUCTIONS[id]?.trim()).toBeTruthy();
    }
  });

  it("guards the wire against anything not in the set", () => {
    for (const id of FORMATS) expect(isFormatId(id)).toBe(true);
    for (const bad of ["JSON", "yaml", "", null, undefined, 7, {}]) {
      expect(isFormatId(bad)).toBe(false);
    }
  });
});

describe("format instructions in the system prompt", () => {
  it("appends the chosen shape for reformat", () => {
    const prompt = buildSystemPrompt({
      mode: "reformat",
      target: "opus_5",
      format: "xml",
    });
    expect(prompt).toContain(FORMAT_INSTRUCTIONS.xml);
  });

  it.each(MODES.filter((m) => m.id !== "reformat").map((m) => m.id))(
    "ignores a format sent with %s — inert, not contradictory",
    (mode) => {
      // The builder gates by mode, so a stale client (or a mode flipped between
      // composing and sending) can never produce a prompt that argues with
      // itself. That is why the route validates legality only.
      const prompt = buildSystemPrompt({ mode, target: "opus_5", format: "json" });
      expect(prompt).not.toContain(FORMAT_INSTRUCTIONS.json);
    },
  );

  it("leaves reformat's prompt unchanged when no shape is chosen", () => {
    const withoutKnob = buildSystemPrompt({ mode: "reformat", target: "opus_5" });
    for (const id of FORMATS) {
      expect(withoutKnob).not.toContain(FORMAT_INSTRUCTIONS[id]);
    }
  });

  it("keeps the envelope contract intact alongside a format", () => {
    // The knob must not displace the output contract — that is the whole
    // reason it is appended rather than substituted.
    const prompt = buildSystemPrompt({
      mode: "reformat",
      target: "opus_5",
      format: "steps",
    });
    expect(prompt).toContain('"output" MUST be the first field');
    expect(prompt).toContain('"rationale" (required, string');
  });
});

describe("format rail", () => {
  it("appears in reformat mode", () => {
    renderComposer();
    expect(screen.getByRole("group", { name: "Output shape" })).toBeTruthy();
  });

  it("gives the five shapes equal columns across the rail", () => {
    // Inline beside the caption there was ~300px for five multi-word labels at
    // 390px: the chassis clipped and "Few-shot" wrapped to two lines. The rail
    // stacks the caption above a full-width control so every label fits on one.
    renderComposer();
    const group = screen.getByRole("group", { name: "Output shape" });
    expect(group.style.gridTemplateColumns).toBe(
      `repeat(${FORMATS.length}, minmax(0, 1fr))`,
    );
    for (const id of FORMATS) {
      expect(screen.getByRole("button", { name: FORMAT_LABEL[id] }).className).toContain(
        "whitespace-nowrap",
      );
    }
  });

  it.each(MODES.filter((m) => m.id !== "reformat").map((m) => m.id))(
    "is hidden in %s mode",
    (mode) => {
      useUIStore.setState({ activeMode: mode });
      renderComposer();
      expect(screen.queryByRole("group", { name: "Output shape" })).toBeNull();
    },
  );

  it("sends nothing until a shape is picked", () => {
    // Unset must mean "absent from the wire", not null — the omitted-key
    // convention every other optional knob follows.
    renderComposer();
    expect(submit().format).toBeUndefined();
  });

  it("sends the picked shape", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "XML" }));
    expect(submit().format).toBe("xml");
  });

  it("clears the shape when the active one is re-picked", () => {
    // Re-picking is the way back to "whichever fits" without spending width
    // on a competing Auto segment.
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    expect(useUIStore.getState().reformatFormat).toBe("json");
    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    expect(useUIStore.getState().reformatFormat).toBeNull();
  });

  it("never leaks a stored shape into another mode's request", () => {
    // The choice persists across mode switches; the request must not.
    useUIStore.setState({ reformatFormat: "json", activeMode: "expand" });
    renderComposer();
    expect(submit().format).toBeUndefined();
  });
});

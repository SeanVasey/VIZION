import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { useUIStore } from "@/stores/ui";
import { MODES } from "@/lib/constants";
import { PROMPT_TEMPLATES } from "@/lib/enhance/templates";

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
vi.mock("@/components/diff/TransformationDiff", () => ({
  TransformationDiff: () => null,
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

const MODE_IDS = new Set(MODES.map((m) => m.id));

beforeEach(() => {
  vi.clearAllMocks();
  useUIStore.setState({ editorDraft: "" });
});

describe("template catalogue", () => {
  it("pairs every template with a real mode", () => {
    for (const t of PROMPT_TEMPLATES) {
      expect(MODE_IDS.has(t.mode)).toBe(true);
    }
  });

  it("has unique ids and non-empty seed text", () => {
    const ids = PROMPT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of PROMPT_TEMPLATES) {
      expect(t.text.trim().length).toBeGreaterThan(0);
      expect(t.title.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("template picker", () => {
  it("is offered on an empty composer", () => {
    renderComposer();
    expect(screen.getByRole("button", { name: /try a template/i })).toBeTruthy();
  });

  it("seeds the draft AND the mode it suits", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /try a template/i }));
    const first = PROMPT_TEMPLATES[0]!;
    fireEvent.click(screen.getByRole("button", { name: new RegExp(first.title, "i") }));

    expect((screen.getByLabelText("Prompt input") as HTMLTextAreaElement).value).toBe(
      first.text,
    );
    expect(useUIStore.getState().activeMode).toBe(first.mode);
  });

  it("disappears once there is a draft, so it can never overwrite work", () => {
    renderComposer();
    fireEvent.change(screen.getByLabelText("Prompt input"), {
      target: { value: "my own prompt" },
    });
    expect(screen.queryByRole("button", { name: /try a template/i })).toBeNull();
  });
});

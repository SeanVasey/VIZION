import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { useUIStore } from "@/stores/ui";
import {
  MAX_DRAFT_PARAM_CHARS,
  resolveDraftParam,
} from "@/lib/pwa/draft-param";

vi.mock("@/lib/enhance/use-enhance", () => ({
  useEnhance: () => ({
    isPending: false,
    isError: false,
    error: null,
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
  }),
}));
vi.mock("@/components/media/AttachmentTray", () => ({ AttachmentTray: () => null }));
vi.mock("@/components/diff/TransformationDiff", () => ({
  TransformationDiff: () => null,
}));

import { EnhanceComposer } from "@/components/editor/EnhanceComposer";

describe("resolveDraftParam", () => {
  it("does nothing without a param", () => {
    expect(resolveDraftParam(null, "")).toEqual({ kind: "none" });
  });

  it("does nothing for an empty or whitespace param", () => {
    expect(resolveDraftParam("", "")).toEqual({ kind: "none" });
    expect(resolveDraftParam("   \n ", "")).toEqual({ kind: "none" });
  });

  it("applies into an empty editor", () => {
    expect(resolveDraftParam("  write a haiku  ", "")).toEqual({
      kind: "apply",
      text: "write a haiku",
    });
  });

  it("treats a whitespace-only editor as empty", () => {
    expect(resolveDraftParam("shared", "   ")).toMatchObject({ kind: "apply" });
  });

  it("NEVER overwrites real work — it reports a conflict instead", () => {
    // A link opened by accident, or a Shortcut fired twice, must not be able
    // to destroy something the user typed.
    expect(resolveDraftParam("shared text", "my own work")).toEqual({
      kind: "conflict",
      text: "shared text",
    });
  });

  it("refuses an oversized param rather than truncating it", () => {
    // A silently truncated prompt is worse than a refused one: the user would
    // run something they never wrote.
    const huge = "x".repeat(MAX_DRAFT_PARAM_CHARS + 1);
    expect(resolveDraftParam(huge, "")).toEqual({ kind: "none" });
  });

  it("accepts a param exactly at the ceiling", () => {
    const atLimit = "x".repeat(MAX_DRAFT_PARAM_CHARS);
    expect(resolveDraftParam(atLimit, "")).toMatchObject({ kind: "apply" });
  });
});

function renderComposer() {
  return render(
    <ToastProvider>
      <EnhanceComposer />
    </ToastProvider>,
  );
}

function visit(search: string) {
  window.history.replaceState(null, "", `/enhance${search}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  useUIStore.setState({ editorDraft: "", activeMode: "clarify" });
  visit("");
});

describe("?draft= prefill", () => {
  it("seeds an empty composer", () => {
    visit("?draft=summarise%20this%20article");
    renderComposer();
    expect((screen.getByLabelText("Prompt input") as HTMLTextAreaElement).value).toBe(
      "summarise this article",
    );
  });

  it("strips the param from the URL so a reload can't re-apply it", () => {
    visit("?draft=hello");
    renderComposer();
    expect(window.location.search).toBe("");
  });

  it("keeps other query params intact while stripping draft", () => {
    visit("?draft=hello&ref=shortcut");
    renderComposer();
    expect(window.location.search).toBe("?ref=shortcut");
  });

  it("strips a rejected param too, so the URL doesn't look live", () => {
    visit(`?draft=${"x".repeat(MAX_DRAFT_PARAM_CHARS + 1)}`);
    renderComposer();
    expect(window.location.search).toBe("");
    expect((screen.getByLabelText("Prompt input") as HTMLTextAreaElement).value).toBe("");
  });

  it("offers rather than overwrites when the composer holds work", () => {
    useUIStore.setState({ editorDraft: "my own prompt" });
    visit("?draft=shared%20prompt");
    renderComposer();

    const textarea = screen.getByLabelText("Prompt input") as HTMLTextAreaElement;
    expect(textarea.value).toBe("my own prompt");
    expect(screen.getByText(/A prompt was shared to VIZ\(IO\)N/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /replace draft/i }));
    expect(useUIStore.getState().editorDraft).toBe("shared prompt");
  });

  it("makes the replacement undoable", () => {
    // Consistent with every other destructive-ish action in the composer.
    useUIStore.setState({ editorDraft: "my own prompt" });
    visit("?draft=shared%20prompt");
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /replace draft/i }));
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(useUIStore.getState().editorDraft).toBe("my own prompt");
  });

  it("does nothing at all on an ordinary visit", () => {
    useUIStore.setState({ editorDraft: "untouched" });
    renderComposer();
    expect(useUIStore.getState().editorDraft).toBe("untouched");
    expect(screen.queryByText(/A prompt was shared/i)).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { useUIStore } from "@/stores/ui";
import { MAX_DRAFT_PARAM_CHARS, resolveDraftParam } from "@/lib/pwa/draft-param";

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

  it("strips the param once applied, so a reload can't re-apply it", () => {
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

  it("does nothing at all on an ordinary visit", () => {
    useUIStore.setState({ editorDraft: "untouched" });
    renderComposer();
    expect(useUIStore.getState().editorDraft).toBe("untouched");
    expect(screen.queryByText(/A prompt was shared/i)).toBeNull();
  });
});

describe("?draft= conflict — the offer has no deadline", () => {
  beforeEach(() => {
    useUIStore.setState({ editorDraft: "my own prompt" });
    visit("?draft=shared%20prompt");
  });

  it("offers rather than overwrites", () => {
    renderComposer();
    expect((screen.getByLabelText("Prompt input") as HTMLTextAreaElement).value).toBe(
      "my own prompt",
    );
    expect(screen.getByText(/A prompt was shared to VIZION/i)).toBeTruthy();
    expect(screen.getByText("shared prompt")).toBeTruthy();
  });

  it("KEEPS the param while the offer is outstanding", () => {
    // The whole point: the incoming prompt must survive longer than any
    // timer. Stripping it here would leave it existing nowhere.
    renderComposer();
    expect(window.location.search).toContain("draft=shared");
  });

  it("does not use a toast, which would expire", () => {
    renderComposer();
    // A toast would be role=status/alert and self-dismiss; the banner is
    // ordinary content that stays until answered.
    //
    // "no status element at all" no longer states that: the composer keeps one
    // permanently mounted for the daily-cap notice, because a live region that
    // arrives already carrying its text is not reliably announced. So the
    // assertion is the thing it always meant — nothing is announcing this
    // banner, and every live region on the surface is empty.
    for (const region of screen.queryAllByRole("status")) {
      expect(region.textContent).toBe("");
    }
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("survives well past a toast's lifetime", () => {
    vi.useFakeTimers();
    try {
      renderComposer();
      act(() => vi.advanceTimersByTime(60_000));
      expect(screen.getByText(/A prompt was shared to VIZION/i)).toBeTruthy();
      expect(window.location.search).toContain("draft=shared");
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies and clears the param on accept", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /replace draft/i }));
    expect(useUIStore.getState().editorDraft).toBe("shared prompt");
    expect(window.location.search).toBe("");
    expect(screen.queryByText(/A prompt was shared to VIZION/i)).toBeNull();
  });

  it("undoes to what was there AT CLICK TIME, not at mount", () => {
    // Typing between the offer appearing and the tap must not be discarded by
    // an Undo that restores a stale snapshot.
    renderComposer();
    fireEvent.change(screen.getByLabelText("Prompt input"), {
      target: { value: "my own prompt, now longer" },
    });
    fireEvent.click(screen.getByRole("button", { name: /replace draft/i }));
    expect(useUIStore.getState().editorDraft).toBe("shared prompt");

    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(useUIStore.getState().editorDraft).toBe("my own prompt, now longer");
  });

  it("discards it explicitly, leaving the draft alone", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /discard it/i }));
    expect(useUIStore.getState().editorDraft).toBe("my own prompt");
    expect(window.location.search).toBe("");
    expect(screen.queryByText(/A prompt was shared to VIZION/i)).toBeNull();
  });
});

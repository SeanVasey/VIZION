import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { diffWords } from "@/lib/enhance/diff";
import { useUIStore } from "@/stores/ui";
import type { EnhanceResponse } from "@/lib/enhance/use-enhance";
import type { MediaItem } from "@/lib/media/queue";

/**
 * Characterization pins for the save-with-outbox control flow shared by
 * TransformationDiff and GenerateSheet (audit 04 redun-05). These branches are
 * incident-hardened (SW-001/SW-002: "Queued" may be claimed ONLY when the
 * outbox write actually landed AND had an owner to land under) and were
 * previously untested — written against the duplicated implementations first,
 * then kept green across the extraction into
 * `src/lib/library/save-with-outbox.ts`, so the refactor is provably
 * behavior-preserving on every branch.
 */

const savePromptAction = vi.fn(
  async (..._args: unknown[]): Promise<Record<string, unknown>> => ({
    ok: true,
    promptId: "p1",
  }),
);
vi.mock("@/lib/library/actions", () => ({
  savePromptAction: (...args: unknown[]) => savePromptAction(...args),
  addVersionAction: vi.fn(async () => ({ ok: true, promptId: "p1" })),
  logShareAction: vi.fn(async () => ({ ok: true })),
}));

const enqueueOutbox = vi.fn(async (..._args: unknown[]) => true);
vi.mock("@/lib/pwa/outbox", () => ({
  enqueueOutbox: (...args: unknown[]) => enqueueOutbox(...args),
}));

import { TransformationDiff } from "@/components/diff/TransformationDiff";
import { GenerateSheet } from "@/components/media/GenerateSheet";

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

function makeResult(input: string, output: string): EnhanceResponse {
  return {
    output,
    rationale: "Tightened the ask.",
    diff: diffWords(input, output),
    tokenIn: 10,
    tokenOut: 20,
    modelUsed: "test-model",
    costUsd: 0.001,
    usage: { todayCost: 0.01, capUsd: 2 },
  };
}

function renderDiffView() {
  const input = "write a summary";
  return render(
    <ToastProvider>
      <TransformationDiff
        input={input}
        mode="clarify"
        target="opus_5"
        result={makeResult(input, "write a concise summary")}
      />
    </ToastProvider>,
  );
}

const MEDIA_ITEM: MediaItem = {
  id: "m1",
  name: "ref.jpg",
  kind: "image",
  sizeBytes: 1024,
  status: "ready",
  role: "generate",
  ephemeral: false,
  attrs: { subject: "a red door", source: "ondevice" },
  genTarget: "midjourney",
};

function renderGenerateSheet() {
  return render(
    <ToastProvider>
      <GenerateSheet item={MEDIA_ITEM} onClose={() => {}} onEngineChange={() => {}} />
    </ToastProvider>,
  );
}

async function clickSave(name: RegExp) {
  const button = screen.getAllByRole("button", { name }).at(-1)!;
  await act(async () => {
    fireEvent.click(button);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
  setOnline(true);
  enqueueOutbox.mockResolvedValue(true);
  act(() => {
    useUIStore.setState({ userId: "user-1" });
  });
});

describe("save-with-outbox — TransformationDiff", () => {
  it("online success links the saved prompt", async () => {
    renderDiffView();
    await clickSave(/save to library/i);
    expect(savePromptAction).toHaveBeenCalledTimes(1);
    expect(enqueueOutbox).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /saved/i })).toHaveAttribute(
      "href",
      "/library/p1",
    );
  });

  it("online duplicate surfaces the resolution choices, not an error", async () => {
    savePromptAction.mockResolvedValueOnce({
      ok: false,
      duplicate: { promptId: "dup1", title: "Existing" },
    });
    renderDiffView();
    await clickSave(/save to library/i);
    expect(screen.getByText(/already in your library/i)).toBeInTheDocument();
  });

  it("online action failure reports the action's error", async () => {
    savePromptAction.mockResolvedValueOnce({ ok: false, error: "RLS said no." });
    renderDiffView();
    await clickSave(/save to library/i);
    expect(screen.getByText("RLS said no.")).toBeInTheDocument();
  });

  it("offline with an owner queues to the outbox — no server call", async () => {
    setOnline(false);
    renderDiffView();
    await clickSave(/save to library/i);
    expect(savePromptAction).not.toHaveBeenCalled();
    expect(enqueueOutbox).toHaveBeenCalledWith(
      "user-1",
      "save-prompt",
      expect.objectContaining({ output: "write a concise summary" }),
    );
    expect(screen.getByText(/queued — syncs when online/i)).toBeInTheDocument();
  });

  it("offline before hydration (no owner) refuses to promise a queue (SW-002)", async () => {
    setOnline(false);
    act(() => {
      useUIStore.setState({ userId: null });
    });
    renderDiffView();
    await clickSave(/save to library/i);
    expect(enqueueOutbox).not.toHaveBeenCalled();
    expect(screen.getByText(/couldn't queue this save/i)).toBeInTheDocument();
  });

  it("offline with a rejecting outbox write says so instead of claiming queued (SW-001)", async () => {
    setOnline(false);
    enqueueOutbox.mockResolvedValueOnce(false);
    renderDiffView();
    await clickSave(/save to library/i);
    expect(screen.getByText(/couldn't queue this save/i)).toBeInTheDocument();
    expect(screen.queryByText(/queued — syncs when online/i)).not.toBeInTheDocument();
  });

  it("an ONLINE server throw is an error to report, never a queue to promise", async () => {
    savePromptAction.mockRejectedValueOnce(new Error("boom"));
    renderDiffView();
    await clickSave(/save to library/i);
    expect(enqueueOutbox).not.toHaveBeenCalled();
    expect(screen.getByText(/couldn't save — try again/i)).toBeInTheDocument();
  });

  it("a throw while offline (connection dropped mid-save) still queues", async () => {
    savePromptAction.mockImplementationOnce(async () => {
      setOnline(false);
      throw new Error("net down");
    });
    renderDiffView();
    await clickSave(/save to library/i);
    expect(enqueueOutbox).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/queued — syncs when online/i)).toBeInTheDocument();
  });
});

describe("save-with-outbox — GenerateSheet", () => {
  it("online duplicate is treated as saved, linking the existing card (LIB-007)", async () => {
    savePromptAction.mockResolvedValueOnce({
      ok: false,
      duplicate: { promptId: "dup2", title: "Existing" },
    });
    renderGenerateSheet();
    await clickSave(/save to library/i);
    expect(screen.getByRole("link", { name: /saved/i })).toHaveAttribute(
      "href",
      "/library/dup2",
    );
  });

  it("offline with an owner queues, with the sheet's own copy", async () => {
    setOnline(false);
    renderGenerateSheet();
    await clickSave(/save to library/i);
    expect(savePromptAction).not.toHaveBeenCalled();
    expect(screen.getByText(/queued — syncs when online/i)).toBeInTheDocument();
  });

  it("offline without an owner shows the sheet's queue-failure copy", async () => {
    setOnline(false);
    act(() => {
      useUIStore.setState({ userId: null });
    });
    renderGenerateSheet();
    await clickSave(/save to library/i);
    expect(enqueueOutbox).not.toHaveBeenCalled();
    expect(screen.getByText(/couldn't queue this save/i)).toBeInTheDocument();
  });

  it("an online failure reports the sheet's error copy", async () => {
    savePromptAction.mockRejectedValueOnce(new Error("boom"));
    renderGenerateSheet();
    await clickSave(/save to library/i);
    expect(screen.getByText(/couldn't save to the library — try again/i)).toBeInTheDocument();
  });
});

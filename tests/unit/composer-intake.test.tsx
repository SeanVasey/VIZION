import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { useUIStore } from "@/stores/ui";

/**
 * Paste and drop intake. The load-bearing invariant: files reach the tray's
 * `onPick`, which owns the first-run privacy disclosure — never `admitFiles`
 * directly, which would upload before disclosing.
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
vi.mock("@/components/diff/TransformationDiff", () => ({
  TransformationDiff: () => null,
}));

// A stand-in tray that publishes its intake exactly like the real one, so the
// composer's wiring is what's under test (the real tray hits Supabase at mount).
const trayIntake = vi.hoisted(() => ({ received: [] as File[][] }));
vi.mock("@/components/media/AttachmentTray", () => ({
  AttachmentTray: ({
    intakeRef,
  }: {
    intakeRef?: { current: ((f: File[] | FileList) => void) | null };
  }) => {
    if (intakeRef) {
      intakeRef.current = (f) => trayIntake.received.push(Array.from(f));
    }
    return null;
  },
}));

import { EnhanceComposer } from "@/components/editor/EnhanceComposer";

function renderComposer() {
  return render(
    <ToastProvider>
      <EnhanceComposer />
    </ToastProvider>,
  );
}

const png = () => new File(["x"], "shot.png", { type: "image/png" });

beforeEach(() => {
  vi.clearAllMocks();
  trayIntake.received = [];
  useUIStore.setState({ editorDraft: "" });
});

describe("composer paste intake", () => {
  it("routes pasted files to the tray intake", () => {
    renderComposer();
    fireEvent.paste(screen.getByLabelText("Prompt input"), {
      clipboardData: { files: [png()], getData: () => "" },
    });
    expect(trayIntake.received).toHaveLength(1);
    expect(trayIntake.received[0]![0]!.name).toBe("shot.png");
  });

  it("leaves pasted text to the native insert", () => {
    renderComposer();
    fireEvent.paste(screen.getByLabelText("Prompt input"), {
      clipboardData: { files: [], getData: () => "hello" },
    });
    expect(trayIntake.received).toHaveLength(0);
  });
});

describe("composer drop intake", () => {
  it("shows a drop hint while files are over the composer and attaches on drop", () => {
    renderComposer();
    const chassis = screen.getByLabelText("Prompt input").closest("div")!;

    fireEvent.dragOver(chassis, { dataTransfer: { types: ["Files"], files: [] } });
    expect(screen.getByText("Drop to attach")).toBeTruthy();

    fireEvent.drop(chassis, { dataTransfer: { types: ["Files"], files: [png()] } });
    expect(screen.queryByText("Drop to attach")).toBeNull();
    expect(trayIntake.received).toHaveLength(1);
  });

  it("ignores dragged text, which is not an attachment", () => {
    renderComposer();
    const chassis = screen.getByLabelText("Prompt input").closest("div")!;
    fireEvent.dragOver(chassis, {
      dataTransfer: { types: ["text/plain"], files: [] },
    });
    expect(screen.queryByText("Drop to attach")).toBeNull();
  });
});

describe("paste-from-clipboard affordance", () => {
  it("is hidden when the browser can't read the clipboard", () => {
    Object.defineProperty(navigator, "clipboard", { value: {}, configurable: true });
    renderComposer();
    fireEvent.focus(screen.getByLabelText("Prompt input"));
    expect(screen.queryByRole("button", { name: /paste from clipboard/i })).toBeNull();
  });

  it("appears on focus with an empty draft and fills it", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: vi.fn(async () => "pasted prompt") },
      configurable: true,
    });
    renderComposer();
    fireEvent.focus(screen.getByLabelText("Prompt input"));
    fireEvent.click(screen.getByRole("button", { name: /paste from clipboard/i }));
    expect(
      await screen.findByDisplayValue("pasted prompt"),
    ).toBeTruthy();
  });

  it("stays hidden once there is a draft to protect", () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: vi.fn(async () => "x") },
      configurable: true,
    });
    renderComposer();
    fireEvent.change(screen.getByLabelText("Prompt input"), {
      target: { value: "my work" },
    });
    fireEvent.focus(screen.getByLabelText("Prompt input"));
    expect(screen.queryByRole("button", { name: /paste from clipboard/i })).toBeNull();
  });

  it("reports a denied clipboard instead of failing silently", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        readText: vi.fn(async () => {
          throw new Error("denied");
        }),
      },
      configurable: true,
    });
    renderComposer();
    fireEvent.focus(screen.getByLabelText("Prompt input"));
    fireEvent.click(screen.getByRole("button", { name: /paste from clipboard/i }));
    expect((await screen.findAllByText(/couldn't read the clipboard/i)).length).toBeGreaterThanOrEqual(
      1,
    );
  });
});

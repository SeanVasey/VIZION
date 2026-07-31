import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { showsNewPromptFab } from "@/components/nav/visibility";
import { isDraftsView, parseLibraryParams } from "@/lib/library/paging";

const routerMock = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const pathnameMock = vi.hoisted(() => ({ value: "/library" }));
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => pathnameMock.value,
}));

interface MockDraftResult {
  ok: boolean;
  draftId?: string;
  error?: string;
  unavailable?: boolean;
}

const draftActions = vi.hoisted(() => ({
  // Typed to the action's full result shape, not inferred from the happy path —
  // otherwise the failure cases below don't typecheck.
  saveDraftAction: vi.fn(
    async (): Promise<{
      ok: boolean;
      draftId?: string;
      error?: string;
      unavailable?: boolean;
    }> => ({ ok: true, draftId: "d1" }),
  ),
}));
vi.mock("@/lib/drafts/actions", () => draftActions);

// The FAB hides while the software keyboard is up; irrelevant here and it
// installs visualViewport listeners jsdom does not provide.
vi.mock("@/components/nav/use-keyboard-visible", () => ({
  useKeyboardVisible: () => false,
}));

import { NewPromptFab } from "@/components/nav/NewPromptFab";
import { useUIStore } from "@/stores/ui";

function renderFab() {
  return render(
    <ToastProvider>
      <NewPromptFab />
    </ToastProvider>,
  );
}

const fab = () => screen.getByRole("button", { name: "New prompt" });

beforeEach(() => {
  vi.clearAllMocks();
  pathnameMock.value = "/library";
  draftActions.saveDraftAction.mockResolvedValue({ ok: true, draftId: "d1" });
  useUIStore.setState({ editorDraft: "", targetModel: "opus_5", activeMode: "clarify" });
});

describe("showsNewPromptFab", () => {
  it("is on Library and Settings only", () => {
    expect(showsNewPromptFab("/library")).toBe(true);
    expect(showsNewPromptFab("/profile")).toBe(true);
    // /enhance already owns this action via the composer's Clear.
    expect(showsNewPromptFab("/enhance")).toBe(false);
    // An allowlist, so nested and unknown authed routes do not inherit it.
    expect(showsNewPromptFab("/library/abc")).toBe(false);
    expect(showsNewPromptFab("/sign-in")).toBe(false);
    // usePathname can be momentarily null during a transition.
    expect(showsNewPromptFab(null)).toBe(false);
  });
});

describe("Library drafts view", () => {
  it("parses view=drafts and is distinguishable from prompt views", () => {
    expect(parseLibraryParams({ view: "drafts" }).view).toBe("drafts");
    expect(isDraftsView(parseLibraryParams({ view: "drafts" }))).toBe(true);
    // The prompt views must NOT read as drafts — queryLibraryPage is skipped
    // on the strength of this predicate, so a false positive would blank the
    // library and a false negative would list prompts under "Drafts".
    for (const view of ["all", "favorites", "archived", undefined]) {
      expect(isDraftsView(parseLibraryParams(view ? { view } : {}))).toBe(false);
    }
  });
});

describe("New prompt button", () => {
  it("goes straight to the composer when there is nothing to lose", () => {
    renderFab();
    fireEvent.click(fab());
    expect(routerMock.push).toHaveBeenCalledWith("/enhance");
    // No dialog in front of a one-tap action that cannot cost anything.
    expect(screen.queryByText("Save this draft?")).toBeNull();
  });

  it("asks before destroying an in-progress draft", () => {
    useUIStore.setState({ editorDraft: "half-written prompt" });
    renderFab();
    fireEvent.click(fab());
    expect(screen.getByText("Save this draft?")).toBeTruthy();
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(useUIStore.getState().editorDraft).toBe("half-written prompt");
  });

  it("saves the whole composer state, then clears and navigates", async () => {
    useUIStore.setState({
      editorDraft: "keep me",
      targetModel: "sonnet_5",
      activeMode: "expand",
      thinkingLevels: { sonnet_5: "high" },
    });
    renderFab();
    fireEvent.click(fab());
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await vi.waitFor(() =>
      expect(draftActions.saveDraftAction).toHaveBeenCalledWith({
        body: "keep me",
        target: "sonnet_5",
        mode: "expand",
        // Resuming into a different model would change what the user gets
        // back, so the target's dial rides along with the body.
        thinkingLevel: "high",
      }),
    );
    await vi.waitFor(() => expect(useUIStore.getState().editorDraft).toBe(""));
    expect(routerMock.push).toHaveBeenCalledWith("/enhance");
  });

  it("KEEPS the draft when the save fails", async () => {
    // The worst outcome available here is destroying the work the user just
    // asked to preserve. A failed save must not navigate either.
    draftActions.saveDraftAction.mockResolvedValue({
      ok: false,
      error: "Couldn't save that draft.",
    });
    useUIStore.setState({ editorDraft: "precious" });
    renderFab();
    fireEvent.click(fab());
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await vi.waitFor(() => expect(draftActions.saveDraftAction).toHaveBeenCalled());
    expect(useUIStore.getState().editorDraft).toBe("precious");
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("treats a missing drafts table as a failed save, not a successful one", async () => {
    draftActions.saveDraftAction.mockResolvedValue({ ok: false, unavailable: true });
    useUIStore.setState({ editorDraft: "precious" });
    renderFab();
    fireEvent.click(fab());
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await vi.waitFor(() => expect(draftActions.saveDraftAction).toHaveBeenCalled());
    expect(useUIStore.getState().editorDraft).toBe("precious");
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("discards undoably — there is no server copy to fall back on", async () => {
    useUIStore.setState({ editorDraft: "throwaway" });
    renderFab();
    fireEvent.click(fab());
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    await vi.waitFor(() => expect(useUIStore.getState().editorDraft).toBe(""));
    expect(draftActions.saveDraftAction).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(useUIStore.getState().editorDraft).toBe("throwaway");
  });

  it("cancel leaves everything exactly as it was", () => {
    useUIStore.setState({ editorDraft: "untouched" });
    renderFab();
    fireEvent.click(fab());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useUIStore.getState().editorDraft).toBe("untouched");
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("renders nothing on the composer itself", () => {
    pathnameMock.value = "/enhance";
    renderFab();
    expect(screen.queryByRole("button", { name: "New prompt" })).toBeNull();
  });

  it("wears the frosted Laser surface, and no shadow utility over its ring", () => {
    renderFab();
    const cls = fab().className;
    // btn-laser carries the §6 contrast law (--on-laser ink on Laser);
    // fab-glass frosts that fill and owns the depth shadow.
    expect(cls).toMatch(/\bbtn-laser\b/);
    expect(cls).toMatch(/\bfab-glass\b/);
    // A utility-layer box-shadow outranks the base-layer :focus-visible ring
    // at equal specificity, which is how this button lost its focus indicator
    // in the first place. The shadow belongs to the component rule now.
    expect(cls).not.toMatch(/\bshadow-/);
  });
});

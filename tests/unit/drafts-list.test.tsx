import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import type { DraftCard } from "@/lib/drafts/queries";
import type { LibraryFilter } from "@/lib/library/paging";

const routerMock = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => "/library",
}));

const actions = vi.hoisted(() => ({
  getDraftBodyAction: vi.fn(
    async (): Promise<{ ok: boolean; body?: string; error?: string }> => ({
      ok: true,
      body: "the full saved body",
    }),
  ),
  deleteDraftAction: vi.fn(
    async (): Promise<{ ok: boolean; error?: string; unavailable?: boolean }> => ({
      ok: true,
    }),
  ),
  updateDraftAction: vi.fn(
    async (): Promise<{ ok: boolean; error?: string; unavailable?: boolean }> => ({
      ok: true,
    }),
  ),
  fetchDraftsPageAction: vi.fn(async () => ({ ok: true, cards: [], nextCursor: null })),
}));
vi.mock("@/lib/drafts/actions", () => actions);

import { DraftsList } from "@/components/library/DraftsList";
import { useUIStore } from "@/stores/ui";

const LONG_BODY = `first line of the draft\n${"x".repeat(400)}`;

const CARD: DraftCard = {
  id: "d1",
  title: "the full saved body",
  // A real card's preview is the first 160 characters of the body. Kept short
  // here on purpose: an editor seeded from this instead of the fetched body
  // would silently truncate the draft on save.
  preview: "the full saved body",
  target_model: "sonnet_5",
  mode: "expand",
  thinking_level: "high",
  created_at: "2026-07-30T00:00:00Z",
  updated_at: "2026-07-30T00:00:00Z",
};

const FILTER: LibraryFilter = { view: "drafts", sort: "updated" };

function renderList(
  cards: DraftCard[] = [CARD],
  unavailable = false,
  filter: LibraryFilter = FILTER,
) {
  return render(
    <ToastProvider>
      <DraftsList
        initialCards={cards}
        nextCursor={null}
        unavailable={unavailable}
        filter={filter}
      />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  actions.getDraftBodyAction.mockResolvedValue({ ok: true, body: "the full saved body" });
  actions.deleteDraftAction.mockResolvedValue({ ok: true });
  actions.updateDraftAction.mockResolvedValue({ ok: true });
  useUIStore.setState({
    editorDraft: "",
    targetModel: "opus_5",
    activeMode: "clarify",
    thinkingLevels: {},
  });
});

describe("Drafts list", () => {
  it("resuming restores the WHOLE composer state, not just the text", async () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: /^the full saved body/ }));

    await vi.waitFor(() =>
      expect(useUIStore.getState().editorDraft).toBe("the full saved body"),
    );
    const s = useUIStore.getState();
    // A draft written against one target must not resume into another — that
    // would silently change what the user gets back.
    expect(s.targetModel).toBe("sonnet_5");
    expect(s.activeMode).toBe("expand");
    expect(s.thinkingLevels.sonnet_5).toBe("high");
    expect(routerMock.push).toHaveBeenCalledWith("/enhance");
  });

  it("resuming is a MOVE — the server copy is dropped", async () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: /^the full saved body/ }));
    await vi.waitFor(() => expect(actions.deleteDraftAction).toHaveBeenCalledWith("d1"));
  });

  it("fetches the body BEFORE deleting, so a failed read loses nothing", async () => {
    actions.getDraftBodyAction.mockResolvedValue({ ok: false, error: "gone" });
    renderList();
    fireEvent.click(screen.getByRole("button", { name: /^the full saved body/ }));

    await vi.waitFor(() => expect(actions.getDraftBodyAction).toHaveBeenCalled());
    expect(actions.deleteDraftAction).not.toHaveBeenCalled();
    expect(useUIStore.getState().editorDraft).toBe("");
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("says so when the draft opened but could not be un-saved", async () => {
    // Not fatal — the body is already in the composer — but silence would leave
    // the same work in two places with no explanation.
    actions.deleteDraftAction.mockResolvedValue({ ok: false, error: "nope" });
    renderList();
    fireEvent.click(screen.getByRole("button", { name: /^the full saved body/ }));
    expect(
      await screen.findByText(/still saved in your library/i),
    ).toBeTruthy();
    expect(routerMock.push).toHaveBeenCalledWith("/enhance");
  });

  it("deleting asks first", async () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: /^Delete draft:/ }));
    expect(screen.getByText("Delete this draft?")).toBeTruthy();
    expect(actions.deleteDraftAction).not.toHaveBeenCalled();
  });

  it("does not claim you have no drafts when a search simply matched none", () => {
    renderList([], false, { view: "drafts", sort: "updated", q: "otters" });
    expect(screen.getByText("No drafts match")).toBeTruthy();
    expect(screen.queryByText("No drafts")).toBeNull();
  });

  it("distinguishes an empty list from a missing table", () => {
    const { unmount } = renderList([]);
    expect(screen.getByText("No drafts")).toBeTruthy();
    unmount();

    // The migration is applied by hand, so the client can know about drafts
    // before the database does. "Nothing saved" would be a lie about data the
    // user may well have.
    renderList([], true);
    expect(screen.getByText(/aren't set up yet/i)).toBeTruthy();
  });
});

describe("Editing a draft in place", () => {
  const openEditor = () =>
    fireEvent.click(screen.getByRole("button", { name: /^Edit draft:/ }));

  it("seeds the editor from the FETCHED body, never the truncated preview", async () => {
    actions.getDraftBodyAction.mockResolvedValue({ ok: true, body: LONG_BODY });
    renderList();
    openEditor();

    const box = (await screen.findByLabelText("Draft text")) as HTMLTextAreaElement;
    // The whole point: the row carries 160 characters, the editor must carry all
    // of it, or saving destroys the rest.
    expect(box.value).toBe(LONG_BODY);
    expect(box.value).not.toBe(CARD.preview);
  });

  it("cannot save before the full body has arrived", async () => {
    // Unresolved fetch — the editor is open but has nothing trustworthy in it.
    actions.getDraftBodyAction.mockReturnValue(new Promise(() => {}) as never);
    renderList();
    openEditor();
    expect(
      await screen.findByRole("button", { name: /Save changes|Saving/ }),
    ).toBeDisabled();
    expect(screen.queryByLabelText("Draft text")).toBeNull();
  });

  it("saves the edited text and does NOT consume the draft", async () => {
    renderList();
    openEditor();
    const box = await screen.findByLabelText("Draft text");
    fireEvent.change(box, { target: { value: "reworded body" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    // Wait on the LAST step of the flow, not the first: the action call is
    // recorded before its continuation runs, so waiting on it would assert
    // against a half-finished save.
    await vi.waitFor(() => expect(routerMock.refresh).toHaveBeenCalled());
    expect(actions.updateDraftAction).toHaveBeenCalledWith("d1", "reworded body");
    // In-place: unlike resume, the row survives and nothing navigates away.
    expect(actions.deleteDraftAction).not.toHaveBeenCalled();
    expect(routerMock.push).not.toHaveBeenCalled();
    // And it does not leak into the live composer.
    expect(useUIStore.getState().editorDraft).toBe("");
  });

  it("refuses to save an empty body", async () => {
    renderList();
    openEditor();
    fireEvent.change(await screen.findByLabelText("Draft text"), {
      target: { value: "   " },
    });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(actions.updateDraftAction).not.toHaveBeenCalled();
  });

  it("keeps the editor open with the text intact when the save fails", async () => {
    actions.updateDraftAction.mockResolvedValue({ ok: false, error: "nope" });
    renderList();
    openEditor();
    const box = await screen.findByLabelText("Draft text");
    fireEvent.change(box, { target: { value: "precious edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
    // Closing here would throw away the edit the user just failed to save.
    expect((screen.getByLabelText("Draft text") as HTMLTextAreaElement).value).toBe(
      "precious edit",
    );
  });

  it("reports a draft that has since been deleted instead of claiming success", async () => {
    actions.updateDraftAction.mockResolvedValue({
      ok: false,
      error: "That draft is no longer there.",
    });
    renderList();
    openEditor();
    fireEvent.change(await screen.findByLabelText("Draft text"), {
      target: { value: "edit into the void" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer there");
  });

  it("surfaces a failed open without pretending the draft is empty", async () => {
    actions.getDraftBodyAction.mockResolvedValue({ ok: false, error: "gone" });
    renderList();
    openEditor();
    expect(await screen.findByText("gone")).toBeTruthy();
    // An empty textarea would invite the user to overwrite the draft with it.
    expect(screen.queryByLabelText("Draft text")).toBeNull();
  });

  it("cancel leaves the draft untouched", async () => {
    renderList();
    openEditor();
    fireEvent.change(await screen.findByLabelText("Draft text"), {
      target: { value: "abandoned" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(actions.updateDraftAction).not.toHaveBeenCalled();
  });
});

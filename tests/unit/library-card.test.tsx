import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import type { PromptCard } from "@/lib/library/queries";

const routerMock = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

const actions = vi.hoisted(() => ({
  fetchLibraryPageAction: vi.fn(
    async (): Promise<{
      ok: boolean;
      cards?: import("@/lib/library/queries").PromptCard[];
      nextCursor?: string | null;
      error?: string;
    }> => ({ ok: true, cards: [], nextCursor: null }),
  ),
  updatePromptTitleAction: vi.fn(async () => ({ ok: true })),
  setFavoriteAction: vi.fn(async () => ({ ok: true })),
  setArchivedAction: vi.fn(async () => ({ ok: true })),
  softDeletePromptAction: vi.fn(async () => ({ ok: true })),
  undoDeletePromptAction: vi.fn(async () => ({ ok: true })),
  deletePromptAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/library/actions", () => actions);

import { LibraryBrowser } from "@/components/library/LibraryBrowser";

const CARD: PromptCard = {
  id: "p1",
  title: "Launch email",
  target_model: "opus_5",
  tags: ["marketing"],
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-27T00:00:00Z",
  favorite: true,
  archived: false,
  deleted: false,
  preview: "Write a friendly launch email announcing the new tier…",
  mode: "target",
  versions: 3,
  collection_id: null,
};

function renderBrowser(cards: PromptCard[] = [CARD]) {
  return render(
    <ToastProvider>
      <LibraryBrowser
        initialCards={cards}
        nextCursor={null}
        filter={{ view: "all", sort: "updated" }}
        facets={{
          models: [{ id: "opus_5", count: 1 }],
          tags: ["marketing"],
          collections: [],
        }}
      />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("library card", () => {
  it("shows title, mode LABEL, model, preview, favorite star, and versions", () => {
    renderBrowser();
    expect(screen.getByText("Launch email")).toBeTruthy();
    // Stored id `target` renders through MODE_LABEL as Adapt.
    expect(screen.getByText(/Adapt · /)).toBeTruthy();
    expect(screen.getByText("Opus 5")).toBeTruthy();
    expect(screen.getByText(/friendly launch email/)).toBeTruthy();
    expect(screen.getByLabelText("Favorite")).toBeTruthy();
    expect(screen.getByText(/3 versions/)).toBeTruthy();
  });

  it("renames through the card actions sheet", async () => {
    renderBrowser();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Launch email" }));
    const input = screen.getByLabelText("Prompt name");
    fireEvent.change(input, { target: { value: "Q3 launch email" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(actions.updatePromptTitleAction).toHaveBeenCalledWith(
      "p1",
      "Q3 launch email",
    );
  });

  it("soft-deletes with an Undo toast that restores", async () => {
    renderBrowser();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Launch email" }));
    fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));
    // Visible card + the permanent aria-live mirror both carry the text.
    expect(
      (await screen.findAllByText("Moved to Recently deleted")).length,
    ).toBeGreaterThanOrEqual(1);
    expect(actions.softDeletePromptAction).toHaveBeenCalledWith("p1");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(actions.undoDeletePromptAction).toHaveBeenCalledWith("p1");
  });

  it("offers permanent delete only for archived prompts", () => {
    renderBrowser([{ ...CARD, archived: true }]);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Launch email" }));
    expect(screen.getByRole("button", { name: "Delete permanently" })).toBeTruthy();
  });

  it("hides permanent delete for active prompts", () => {
    renderBrowser();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Launch email" }));
    expect(screen.queryByRole("button", { name: "Delete permanently" })).toBeNull();
  });
});


describe("recently deleted (Q9 — persistent recovery)", () => {
  const TRASHED: PromptCard = { ...CARD, deleted: true, favorite: false };

  it("offers Restore and confirmed permanent delete — nothing else", async () => {
    renderBrowser([TRASHED]);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Launch email" }));
    // The normal verbs don't apply to a prompt no list shows.
    expect(screen.queryByRole("button", { name: /Add to favorites|Archive/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await vi.waitFor(() =>
      expect(actions.undoDeletePromptAction).toHaveBeenCalledWith("p1"),
    );
  });

  it("permanent delete requires the confirm sheet", async () => {
    renderBrowser([TRASHED]);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Launch email" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    expect(actions.deletePromptAction).not.toHaveBeenCalled();
    // The confirm sheet opens its own "Delete permanently" — the last one is
    // the confirmation.
    await vi.waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "Delete permanently" }).length,
      ).toBe(2),
    );
    const confirmBtns = screen.getAllByRole("button", { name: "Delete permanently" });
    fireEvent.click(confirmBtns[confirmBtns.length - 1]!);
    await vi.waitFor(() =>
      expect(actions.deletePromptAction).toHaveBeenCalledWith("p1"),
    );
  });
});

const PAGE2: PromptCard = {
  ...CARD,
  id: "p2",
  title: "Page two prompt",
  favorite: false,
};

describe("library page seams (LIB-003 — the DraftsList lesson, replayed)", () => {
  function renderWithCursor(cards: PromptCard[] = [CARD]) {
    return render(
      <ToastProvider>
        <LibraryBrowser
          initialCards={cards}
          nextCursor="c1"
          filter={{ view: "all", sort: "updated" }}
          facets={{ models: [{ id: "opus_5", count: 1 }], tags: [], collections: [] }}
        />
      </ToastProvider>,
    );
  }

  it("a mutation drops accumulated pages and re-pages from the CURRENT boundary", async () => {
    actions.fetchLibraryPageAction.mockResolvedValue({
      ok: true,
      cards: [PAGE2],
      nextCursor: "c2",
    });
    renderWithCursor();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Page two prompt")).toBeTruthy();

    // Mutate via the actions sheet — the stale accumulated page must clear:
    // the refreshed page 1 will re-rank rows, and a kept copy would duplicate
    // (or a kept cursor would permanently skip the displaced row).
    fireEvent.click(screen.getByRole("button", { name: "Actions for Launch email" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove from favorites" }));
    await vi.waitFor(() =>
      expect(actions.setFavoriteAction).toHaveBeenCalledWith("p1", false),
    );
    expect(screen.queryByText("Page two prompt")).toBeNull();

    // The next Load more pages from the PROP boundary (c1), not the stale c2.
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await vi.waitFor(() =>
      expect(actions.fetchLibraryPageAction).toHaveBeenLastCalledWith(
        expect.anything(),
        "c1",
      ),
    );
  });

  it("never renders the same card twice when a refreshed page overlaps", async () => {
    actions.fetchLibraryPageAction.mockResolvedValue({
      ok: true,
      cards: [PAGE2],
      nextCursor: null,
    });
    const { rerender } = renderWithCursor();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Page two prompt")).toBeTruthy();

    // A refresh whose page 1 now CONTAINS the page-2 card (it moved up after
    // an edit elsewhere) must not draw it twice from the stale extras.
    rerender(
      <ToastProvider>
        <LibraryBrowser
          initialCards={[PAGE2, CARD]}
          nextCursor="c1"
          filter={{ view: "all", sort: "updated" }}
          facets={{ models: [{ id: "opus_5", count: 1 }], tags: [], collections: [] }}
        />
      </ToastProvider>,
    );
    expect(screen.getAllByText("Page two prompt")).toHaveLength(1);
  });
});

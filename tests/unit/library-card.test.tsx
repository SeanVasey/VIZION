import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import type { PromptCard } from "@/lib/library/queries";

const routerMock = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

const actions = vi.hoisted(() => ({
  fetchLibraryPageAction: vi.fn(async () => ({ ok: true, cards: [], nextCursor: null })),
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
    expect(await screen.findByRole("status")).toHaveTextContent("Prompt deleted");
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

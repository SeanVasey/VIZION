import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { CollectionFacet, PromptCard } from "@/lib/library/queries";

const routerMock = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

const actions = vi.hoisted(() => ({
  setCollectionAction: vi.fn(async () => ({ ok: true })),
  createCollectionAction: vi.fn(async () => ({ ok: true, id: "c-new" })),
  renameCollectionAction: vi.fn(async () => ({ ok: true })),
  deleteCollectionAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/library/actions", () => actions);

import { CollectionSheet } from "@/components/library/CollectionSheet";

const PROMPT: PromptCard = {
  id: "p1",
  title: "Launch email",
  target_model: "opus_5",
  tags: [],
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-27T00:00:00Z",
  favorite: false,
  archived: false,
  deleted: false,
  preview: null,
  mode: "target",
  versions: 1,
  collection_id: "c1",
};

const COLLECTIONS: CollectionFacet[] = [
  { id: "c1", name: "Campaigns", count: 3 },
  { id: "c2", name: "Drafts", count: 0 },
];

function renderSheet(overrides: Partial<Parameters<typeof CollectionSheet>[0]> = {}) {
  const onMoved = vi.fn();
  const utils = render(
    <CollectionSheet
      open
      onClose={vi.fn()}
      prompt={PROMPT}
      collections={COLLECTIONS}
      onMoved={onMoved}
      {...overrides}
    />,
  );
  return { ...utils, onMoved };
}

beforeEach(() => vi.clearAllMocks());

describe("CollectionSheet", () => {
  it("moves the prompt into a tapped collection and closes the stack", async () => {
    const { onMoved } = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /^Drafts \d/ }));
    await vi.waitFor(() =>
      expect(actions.setCollectionAction).toHaveBeenCalledWith("p1", "c2"),
    );
    expect(onMoved).toHaveBeenCalled();
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it("marks the current collection and taps it to remove", async () => {
    renderSheet();
    const current = screen.getByRole("button", { name: /^Campaigns \d/ });
    expect(current).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(current);
    await vi.waitFor(() =>
      expect(actions.setCollectionAction).toHaveBeenCalledWith("p1", null),
    );
  });

  it("creates a collection inline then moves the prompt into it", async () => {
    renderSheet();
    fireEvent.change(screen.getByLabelText("New collection name"), {
      target: { value: "  Ideas " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await vi.waitFor(() =>
      expect(actions.createCollectionAction).toHaveBeenCalledWith("Ideas"),
    );
    await vi.waitFor(() =>
      expect(actions.setCollectionAction).toHaveBeenCalledWith("p1", "c-new"),
    );
  });

  it("renames a collection through the inline editor", async () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Rename Drafts" }));
    fireEvent.change(screen.getByLabelText("Collection name"), {
      target: { value: "Sketches" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() =>
      expect(actions.renameCollectionAction).toHaveBeenCalledWith("c2", "Sketches"),
    );
  });

  it("deletes a collection behind a confirm that says prompts are kept", async () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Delete Drafts" }));
    expect(screen.getByText(/Prompts inside are kept/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete collection" }));
    await vi.waitFor(() =>
      expect(actions.deleteCollectionAction).toHaveBeenCalledWith("c2"),
    );
  });

  it("surfaces a duplicate-name error instead of closing", async () => {
    actions.createCollectionAction.mockResolvedValueOnce({
      ok: false,
      error: "You already have a collection with that name.",
    } as never);
    const { onMoved } = renderSheet();
    fireEvent.change(screen.getByLabelText("New collection name"), {
      target: { value: "Campaigns" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(
      await screen.findByText("You already have a collection with that name."),
    ).toBeTruthy();
    expect(onMoved).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import type { PromptCard } from "@/lib/library/queries";

const routerMock = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

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
  tags: [],
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-27T00:00:00Z",
  favorite: false,
  archived: false,
  preview: "Write a friendly launch email…",
  mode: "target",
  versions: 1,
  collection_id: null,
};

function renderBrowser(cards: PromptCard[] = [CARD]) {
  return render(
    <ToastProvider>
      <LibraryBrowser
        initialCards={cards}
        nextCursor={null}
        filter={{ view: "all", sort: "updated" }}
        facets={{ models: [], tags: [], collections: [] }}
      />
    </ToastProvider>,
  );
}

/** The two action panels, in document order: favourite (left), delete (right). */
function panels(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll("li > div.absolute")] as HTMLElement[];
}

const row = (container: HTMLElement) => container.querySelector("li")!;
const dragSurface = (container: HTMLElement) =>
  container.querySelector("li > div.relative") as HTMLElement;

/**
 * A pointer event jsdom will actually carry coordinates on.
 *
 * jsdom defines no `PointerEvent`, so `fireEvent.pointerDown(el, {clientX})`
 * silently drops the coordinate: the hook then computes `undefined - undefined`
 * and every downstream comparison against NaN is false. That failure is
 * invisible — the row's transform becomes `translateX(NaNpx)`, which is not
 * equal to `translateX(0px)`, so a naive "did it move?" assertion passes while
 * nothing has moved at all. MouseEvent does carry clientX/clientY, and React
 * dispatches on the event's `type` string, so a MouseEvent typed `pointerdown`
 * reaches `onPointerDown` with real numbers.
 */
function pointer(type: string, clientX: number, clientY = 0): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
  });
  Object.defineProperty(event, "pointerType", { value: "touch" });
  return event;
}

/** Drag the row far enough to open it, in the given direction. */
function drag(surface: HTMLElement, from: number, to: number) {
  act(() => {
    fireEvent(surface, pointer("pointerdown", from));
    fireEvent(surface, pointer("pointermove", to));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the resting card carries no action colour", () => {
  it("hides BOTH swipe panels until the row moves", () => {
    // The reported bug. Both panels used to render permanently; the card above
    // them is .glass, which transmits 28% in dark, so every row showed an
    // olive left edge and a muddy red right edge — constant, and identical on
    // every card regardless of model.
    const { container } = renderBrowser();
    const [left, right] = panels(container);
    expect(left!.className).toContain("opacity-0");
    expect(right!.className).toContain("opacity-0");
    expect(left!.className).toContain("pointer-events-none");
    expect(right!.className).toContain("pointer-events-none");
  });

  it("proves the drag harness actually moves the row", () => {
    // Guards every other test in this block. Asserted as an EXACT offset, not
    // as "changed": `translateX(NaNpx)` also differs from `translateX(0px)`,
    // which is how a harness that transports no coordinates passes for free.
    const { container } = renderBrowser();
    const surface = dragSurface(container);
    expect(surface.style.transform).toBe("translateX(0px)");
    drag(surface, 300, 200);
    expect(surface.style.transform).toBe("translateX(-84px)");
  });

  it("reveals ONLY the side being dragged", () => {
    // One shared flag would light the opposite gutter too, putting the bleed
    // straight back on the edge the user is dragging away from.
    const { container } = renderBrowser();
    drag(dragSurface(container), 300, 200);
    const [left, right] = panels(container);
    expect(right!.className).toContain("opacity-100");
    expect(left!.className).toContain("opacity-0");
  });

  it("reveals the favourite side on the opposite drag", () => {
    const { container } = renderBrowser();
    drag(dragSurface(container), 100, 200);
    const [left, right] = panels(container);
    expect(left!.className).toContain("opacity-100");
    expect(right!.className).toContain("opacity-0");
  });

  it("keeps the developer field out of the way while an action is exposed", () => {
    // Mid-drag is the one moment a full-strength --flare panel abuts the
    // card's trailing edge. The field steps aside so the action colour is the
    // only chromatic signal there.
    const { container } = renderBrowser();
    const edge = container.querySelector(".dev-edge") as HTMLElement;
    expect(edge.hasAttribute("data-swiping")).toBe(false);
    drag(dragSurface(container), 300, 200);
    expect(edge.hasAttribute("data-swiping")).toBe(true);
  });

  it("keeps the resting Delete button out of the accessibility tree", () => {
    // aria-hidden is what stops the swipe Delete colliding with the ⋯ menu's
    // Delete in every by-name query on this page.
    renderBrowser();
    expect(screen.queryByRole("button", { name: /^Delete Launch email/ })).toBeNull();
  });
});

describe("the developer mark", () => {
  it("renders in the developer's own colour, not the app's action accent", () => {
    // The mark is the sole non-redundant carrier of identity, so it must not
    // quietly revert to text-accent like every other call site.
    const { container } = renderBrowser();
    const mark = container.querySelector("svg.dev-mark");
    expect(mark).not.toBeNull();
    expect(mark!.getAttribute("class")).not.toContain("text-accent");
    expect(mark!.querySelector("path")!.getAttribute("fill")).toBe("currentColor");
  });

  it("carries the developer's token down from the row", () => {
    // The value cannot be a composed Tailwind class — the config scans source
    // text, so `bg-[${hex}]` would generate nothing — so it arrives as an
    // inline custom property and this is what proves it arrived.
    const { container } = renderBrowser();
    expect(row(container).style.getPropertyValue("--dev")).toBe("var(--dev-anthropic)");
  });

  it("adds no text, so the model name stays a single readable node", () => {
    // DeveloperIcon is aria-hidden; a label or sr-only string added later
    // would break every getByText on the model name.
    renderBrowser();
    expect(screen.getByText("Opus 5")).toBeTruthy();
  });

  it("degrades to no mark, and no colour, on an id this build doesn't know", () => {
    // PromptCard.target_model is a plain string, so a card can hold a retired
    // id. DeveloperIcon throws on an unknown key, which would blank-screen the
    // whole library rather than lose one glyph.
    const { container } = renderBrowser([{ ...CARD, target_model: "some_retired_id" }]);
    expect(container.querySelector("svg.dev-mark")).toBeNull();
    expect(row(container).style.getPropertyValue("--dev")).toBe("");
    expect(screen.getByText("some_retired_id")).toBeTruthy();
  });

  it("keeps a renamed id's colour instead of dropping it", () => {
    // LEGACY_TARGET_IDS exists precisely so a rename doesn't orphan saved
    // prompts; the accent has to follow the same map.
    const { container } = renderBrowser([{ ...CARD, target_model: "opus_4_8" }]);
    expect(row(container).style.getPropertyValue("--dev")).toBe("var(--dev-anthropic)");
  });
});

describe("the delete panel's ink", () => {
  it("uses --on-flare, which the light theme flips", () => {
    // The Void ink on the light theme's --flare #c81d10 is 3.30:1 — an AA fail
    // for this glyph. Dark is unchanged.
    const { container } = renderBrowser();
    const [, right] = panels(container);
    const button = right!.querySelector("button")!;
    expect(button.className).toContain("text-[color:var(--on-flare)]");
    expect(button.className).not.toContain("text-on-laser");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { HoldSliderTrigger, type Detent } from "@/components/ui/HoldSlider";
import {
  DETENT_SPACING_PX,
  EDGE_MARGIN_PX,
  HOLD_MS,
  SLOP_PX,
  TRACK_PAD_PX,
  computeTrackGeometry,
  detentIndexForX,
} from "@/components/ui/use-hold-drag";

/**
 * The hold-slider primitive (docs/decisions/0012-hold-slider.md).
 *
 * The load-bearing contract is the SPLIT: a tap must remain exactly the tap
 * it always was (the wrapped pill's click opens the sheet — the accessible
 * path), while only a deliberate hold engages the overlay track. Every test
 * here guards one side of that line, or the gesture's exits (commit, Escape,
 * pointercancel), which must never leak a phantom click into the pill.
 *
 * Geometry is tested through the exported pure functions because jsdom has
 * no layout — which is also why the functions are pure: detent mapping
 * derives from the pointer-down x and the spacing constants, never from
 * measuring rendered dots.
 */

const DETENTS: readonly Detent[] = [
  { id: "auto", label: "Auto", tone: "faint" },
  { id: "low", label: "Low", tone: "silver" },
  { id: "medium", label: "Medium", tone: "laser" },
  { id: "high", label: "High", tone: "laser" },
  { id: "xhigh", label: "Extra High", tone: "ultra" },
  { id: "max", label: "Max", tone: "ultra" },
];

const liveLabel = (d: Detent) => `Fable 5 · ${d.label}`;

function Host({
  enabled = true,
  selectedIndex = 0,
  onCommit = () => {},
  onOpen = () => {},
}: {
  enabled?: boolean;
  selectedIndex?: number;
  onCommit?: (i: number) => void;
  onOpen?: () => void;
}) {
  return (
    <HoldSliderTrigger
      detents={DETENTS}
      selectedIndex={selectedIndex}
      liveLabel={liveLabel}
      onCommit={onCommit}
      enabled={enabled}
    >
      <button type="button" onClick={onOpen}>
        Pill
      </button>
    </HoldSliderTrigger>
  );
}

const pill = () => screen.getByRole("button", { name: "Pill" });
const overlay = () =>
  document.querySelector<HTMLElement>("[data-hold-slider-overlay]");

/** Down at a known x so drag targets derive from the spacing constant. */
const DOWN_X = 300;
const down = (opts: Partial<PointerEventInit> = {}) =>
  fireEvent.pointerDown(pill(), {
    pointerId: 1,
    clientX: DOWN_X,
    clientY: 400,
    button: 0,
    ...opts,
  });
const moveTo = (x: number, y = 400) =>
  fireEvent.pointerMove(pill(), { pointerId: 1, clientX: x, clientY: y });
const up = (x = DOWN_X) =>
  fireEvent.pointerUp(pill(), { pointerId: 1, clientX: x, clientY: 400 });
// act(): the hold timer fires outside any event, so its setState needs an
// explicit flush — every fireEvent is already wrapped by the library.
const hold = () => act(() => vi.advanceTimersByTime(HOLD_MS));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("track geometry (pure)", () => {
  const rect = { top: 500, height: 44 };

  it("anchors the selected detent under the finger", () => {
    const geo = computeTrackGeometry(DOWN_X, rect, 6, 2, 1024);
    expect(geo.detentCenters[2]).toBe(DOWN_X);
    expect(geo.detentCenters).toHaveLength(6);
    // Even spacing, ascending.
    expect(geo.detentCenters[3]! - geo.detentCenters[2]!).toBe(DETENT_SPACING_PX);
  });

  it("clamps to the viewport edges instead of overflowing", () => {
    // Finger near the left edge with the selection far right: the ideal
    // placement would start off-screen; the clamp pins the margin instead.
    const left = computeTrackGeometry(20, rect, 6, 5, 1024);
    expect(left.left).toBe(EDGE_MARGIN_PX);
    const right = computeTrackGeometry(1010, rect, 6, 0, 1024);
    expect(right.left + right.width).toBe(1024 - EDGE_MARGIN_PX);
  });

  it("sizes the track from the detent count", () => {
    const geo = computeTrackGeometry(DOWN_X, rect, 4, 0, 1024);
    expect(geo.width).toBe(3 * DETENT_SPACING_PX + 2 * TRACK_PAD_PX);
  });

  it("maps x to the nearest detent, clamped at the ends", () => {
    const geo = computeTrackGeometry(DOWN_X, rect, 6, 0, 1024);
    expect(detentIndexForX(DOWN_X, geo)).toBe(0);
    expect(detentIndexForX(DOWN_X + 2 * DETENT_SPACING_PX + 10, geo)).toBe(2);
    expect(detentIndexForX(DOWN_X - 500, geo)).toBe(0);
    expect(detentIndexForX(DOWN_X + 5000, geo)).toBe(5);
  });
});

describe("tap vs hold", () => {
  it("keeps a quick tap a tap — the pill's click fires untouched", () => {
    const onOpen = vi.fn();
    const onCommit = vi.fn();
    render(<Host onOpen={onOpen} onCommit={onCommit} />);
    down();
    vi.advanceTimersByTime(HOLD_MS - 50);
    up();
    fireEvent.click(pill());
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
    expect(overlay()).toBeNull();
  });

  it("expands the overlay after the hold, aria-hidden and pointer-inert", () => {
    render(<Host />);
    down();
    expect(overlay()).toBeNull();
    hold();
    const el = overlay();
    expect(el).not.toBeNull();
    expect(el!.getAttribute("aria-hidden")).toBe("true");
    expect(el!.className).toContain("pointer-events-none");
    // Portalled past the composer's overflow-hidden chassis.
    expect(el!.parentElement).toBe(document.body);
  });

  it("stands down when the press moves past slop before the hold", () => {
    const onCommit = vi.fn();
    render(<Host onCommit={onCommit} />);
    down();
    moveTo(DOWN_X + SLOP_PX + 4);
    hold();
    expect(overlay()).toBeNull();
    up();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("is fully inert when disabled — no axis claim, no overlay", () => {
    render(<Host enabled={false} />);
    const wrapper = pill().parentElement!;
    // React omits the style attribute entirely when the hook returns none —
    // a disabled wrapper carries no claim at all, not an empty one.
    expect(wrapper.hasAttribute("style")).toBe(false);
    down();
    hold();
    expect(overlay()).toBeNull();
  });

  it("claims pan-y pinch-zoom (never none) while enabled", () => {
    render(<Host />);
    expect(pill().parentElement!.style.touchAction).toBe("pan-y pinch-zoom");
  });
});

describe("drag, commit, and the trailing click", () => {
  it("drags to a detent and commits it on release", () => {
    const onCommit = vi.fn();
    const onOpen = vi.fn();
    render(<Host onCommit={onCommit} onOpen={onOpen} />);
    down();
    hold();
    moveTo(DOWN_X + 3 * DETENT_SPACING_PX);
    up(DOWN_X + 3 * DETENT_SPACING_PX);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(3);
    expect(overlay()).toBeNull();
    // The browser click that follows the lift must NOT open the sheet.
    fireEvent.click(pill());
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("starts the drag from the committed detent, not from zero", () => {
    const onCommit = vi.fn();
    render(<Host selectedIndex={2} onCommit={onCommit} />);
    down();
    hold();
    // One detent right of the anchor = one step up from the selection.
    moveTo(DOWN_X + DETENT_SPACING_PX);
    up(DOWN_X + DETENT_SPACING_PX);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(3);
  });

  it("shows the live label and tone for the detent under the finger", () => {
    render(<Host />);
    down();
    hold();
    moveTo(DOWN_X + 4 * DETENT_SPACING_PX);
    const el = overlay()!;
    expect(el.textContent).toContain("Fable 5 · Extra High");
    expect(
      el.querySelector("[data-tone]")!.getAttribute("data-tone"),
    ).toBe("ultra");
  });

  it("announces the committed value through the live region", () => {
    render(<Host />);
    const region = screen.getByRole("status");
    expect(region.textContent).toBe("");
    down();
    hold();
    moveTo(DOWN_X + 5 * DETENT_SPACING_PX);
    up(DOWN_X + 5 * DETENT_SPACING_PX);
    expect(region.textContent).toBe("Fable 5 · Max");
  });
});

describe("revert paths", () => {
  it("reverts without committing on pointercancel", () => {
    const onCommit = vi.fn();
    render(<Host onCommit={onCommit} />);
    down();
    hold();
    moveTo(DOWN_X + DETENT_SPACING_PX);
    fireEvent.pointerCancel(pill(), { pointerId: 1 });
    expect(overlay()).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("reverts on Escape and still swallows the eventual lift's click", () => {
    const onCommit = vi.fn();
    const onOpen = vi.fn();
    render(<Host onCommit={onCommit} onOpen={onOpen} />);
    down();
    hold();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(overlay()).toBeNull();
    // The finger lifts much later — no commit, and no phantom sheet-open.
    vi.advanceTimersByTime(2000);
    up();
    fireEvent.click(pill());
    expect(onCommit).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("suppresses the context menu only while a gesture is live", () => {
    render(<Host />);
    const atRest = fireEvent.contextMenu(pill());
    expect(atRest).toBe(true); // not prevented
    down();
    hold();
    const midGesture = fireEvent.contextMenu(pill());
    expect(midGesture).toBe(false); // prevented
  });
});

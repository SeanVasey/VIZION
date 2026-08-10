import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import {
  HoldSliderTrigger,
  type Detent,
  type DetentMarker,
} from "@/components/ui/HoldSlider";
import {
  CENTER_INSET_PX,
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
 * path), while a deliberate hold — or a sideways slide in the same unbroken
 * press, the reference gesture — engages the overlay track. Every test here
 * guards one side of that line, or the gesture's exits (commit, Escape,
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
  detentMarker,
}: {
  enabled?: boolean;
  selectedIndex?: number;
  onCommit?: (i: number) => void;
  onOpen?: () => void;
  detentMarker?: DetentMarker;
}) {
  return (
    <HoldSliderTrigger
      detents={DETENTS}
      selectedIndex={selectedIndex}
      liveLabel={liveLabel}
      onCommit={onCommit}
      enabled={enabled}
      detentMarker={detentMarker}
    >
      <button type="button" onClick={onOpen}>
        Pill
      </button>
    </HoldSliderTrigger>
  );
}

const pill = () => screen.getByRole("button", { name: "Pill" });
const overlay = () => document.querySelector<HTMLElement>("[data-hold-slider-overlay]");

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

  const wholeViewport = (width: number) => ({ left: 0, width });

  it("lands in its fixed home — viewport-centered, on the rail's row", () => {
    // ADR-0012 amendment 4: the first cut anchored the selected detent under
    // the finger, so the capsule landed wherever the press happened to be.
    // The home is now fixed: centered in the viewport (the shell is a
    // centered column, so viewport center IS the composer's), rail's y.
    const geo = computeTrackGeometry(rect, 6, wholeViewport(1024));
    expect(geo.width).toBe(5 * DETENT_SPACING_PX + 2 * TRACK_PAD_PX);
    expect(geo.left).toBe((1024 - geo.width) / 2);
    expect(geo.top).toBe(500 + rect.height / 2 - geo.height / 2);
    expect(geo.detentCenters).toHaveLength(6);
    expect(geo.detentCenters[0]).toBe(geo.left + TRACK_PAD_PX);
    // Even spacing, ascending.
    expect(geo.detentCenters[3]! - geo.detentCenters[2]!).toBe(DETENT_SPACING_PX);
    // The selection cannot steer placement in ANY mode: it is not even an
    // input to the geometry — that is what keeps the home fixed.
  });

  it("stays centered on a phone viewport", () => {
    const geo = computeTrackGeometry(rect, 6, wholeViewport(390));
    expect(geo.left).toBe((390 - geo.width) / 2);
  });

  it("centers in the VISUAL viewport under pinch zoom", () => {
    // The control preserves native pinch zoom, and a fixed-position capsule
    // centered on the LAYOUT viewport can open entirely outside a zoomed-in
    // user's view (Codex review, PR #103). The caller passes the visual
    // viewport's offset/width; the home must sit inside that region.
    const geo = computeTrackGeometry(rect, 3, { left: 300, width: 200 });
    expect(geo.width).toBe(2 * DETENT_SPACING_PX + 2 * TRACK_PAD_PX);
    expect(geo.left).toBe(300 + (200 - geo.width) / 2);
    expect(geo.left).toBeGreaterThanOrEqual(300);
    expect(geo.left + geo.width).toBeLessThanOrEqual(500);
  });

  it("compresses the ladder to fit a narrow region — every detent reachable", () => {
    // Codex review, third pass: a placement frozen around the selected
    // detent kept the SPAWN visible but let the drag walk the thumb out of
    // a region narrower than the track. Compressed spacing removes the
    // edge entirely: the whole ladder fits, geometry stays static and
    // centered, and zoom multiplies physical travel so the tighter detents
    // cost no precision.
    const region = { left: 300, width: 200 };
    const geo = computeTrackGeometry(rect, 6, region);
    const spacing = geo.detentCenters[1]! - geo.detentCenters[0]!;
    expect(spacing).toBeCloseTo(124 / 5, 5); // (200 - 2·16 - 2·22) / 5
    expect(geo.width).toBeCloseTo(5 * spacing + 2 * TRACK_PAD_PX, 5);
    expect(geo.left).toBeCloseTo(300 + (200 - geo.width) / 2, 5);
    // Every detent center sits inside the visible region…
    for (const center of geo.detentCenters) {
      expect(center).toBeGreaterThanOrEqual(300);
      expect(center).toBeLessThanOrEqual(500);
    }
    // …and the nearest-detent mapping follows the geometry's own spacing.
    expect(detentIndexForX(geo.detentCenters[3]! + 10, geo)).toBe(3);
  });

  it("sheds the capsule's chrome below the floor — centers stay reachable", () => {
    // Codex review, fourth pass, exact scenario: a 320px phone at 400% zoom
    // exposes an 80px region. Reserving pads and margins would leave far
    // detents beyond any possible pointer travel; instead the geometry
    // constrains only the detent SPAN — the rounded ends may overflow the
    // region (the overlay is pointer-transparent decoration) while every
    // CENTER compresses into the region minus CENTER_INSET_PX.
    const region = { left: 300, width: 80 };
    const geo = computeTrackGeometry(rect, 6, region);
    const spacing = geo.detentCenters[1]! - geo.detentCenters[0]!;
    expect(spacing).toBeCloseTo((80 - 2 * CENTER_INSET_PX) / 5, 5);
    // All six centers inside the region, extremes inset from its edges…
    expect(geo.detentCenters[0]).toBeCloseTo(300 + CENTER_INSET_PX, 5);
    expect(geo.detentCenters[5]).toBeCloseTo(380 - CENTER_INSET_PX, 5);
    for (const center of geo.detentCenters) {
      expect(center).toBeGreaterThanOrEqual(300);
      expect(center).toBeLessThanOrEqual(380);
    }
    // …so the full ladder needs 64px of travel inside an 80px region.
    expect(geo.detentCenters[5]! - geo.detentCenters[0]!).toBeLessThan(80);
    // The capsule's chrome is what overflows, by design.
    expect(geo.left).toBeLessThan(300);
    // Mapping still follows the geometry's own spacing.
    expect(detentIndexForX(geo.detentCenters[4]! + spacing / 4, geo)).toBe(4);
  });

  it("compresses on a narrow layout viewport too", () => {
    // Eight detents on a 360px phone: full spacing would need 352px; the
    // ladder compresses to fit inside the margins instead.
    const narrow = computeTrackGeometry(rect, 8, wholeViewport(360));
    const spacing = narrow.detentCenters[1]! - narrow.detentCenters[0]!;
    expect(spacing).toBeCloseTo((360 - 32 - 44) / 7, 5);
    expect(narrow.width).toBeLessThanOrEqual(360 - 2 * EDGE_MARGIN_PX);
    expect(narrow.left).toBeCloseTo((360 - narrow.width) / 2, 5);
  });

  it("sizes the track from the detent count", () => {
    const geo = computeTrackGeometry(rect, 4, wholeViewport(1024));
    expect(geo.width).toBe(3 * DETENT_SPACING_PX + 2 * TRACK_PAD_PX);
  });

  it("maps x to the nearest detent, clamped at the ends", () => {
    const geo = computeTrackGeometry(rect, 6, wholeViewport(1024));
    const first = geo.detentCenters[0]!;
    expect(detentIndexForX(first, geo)).toBe(0);
    expect(detentIndexForX(first + 2 * DETENT_SPACING_PX + 10, geo)).toBe(2);
    expect(detentIndexForX(first - 500, geo)).toBe(0);
    expect(detentIndexForX(first + 5000, geo)).toBe(5);
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
    // The live readout is a chip on the track's own glass ground, never bare
    // text colliding with whatever the composer has at that y — and it says
    // only the LEVEL: the context is on screen already and in the commit
    // announcement, so the chip never stacks "Fable 5" beside "Fable 5".
    const label = el!.querySelector("[data-hold-slider-label]")!;
    expect(label.className).toContain("glass-solid");
    expect(label.textContent).toBe("Auto");
  });

  it("drops the focus pair behind the capsule, gone the moment it settles", () => {
    render(<Host />);
    const scrim = () => document.querySelector("[data-hold-slider-scrim]");
    const blur = () => document.querySelector("[data-hold-slider-blur]");
    expect(scrim()).toBeNull();
    expect(blur()).toBeNull();
    down();
    hold();
    expect(scrim()).not.toBeNull();
    expect(scrim()!.getAttribute("aria-hidden")).toBe("true");
    expect(scrim()!.className).toContain("pointer-events-none");
    // The blur layer is the static half of the pair: its class carries the
    // backdrop-filter (stand-downs strip it in CSS), and it must precede
    // the dim in the DOM so the fade rides ABOVE the filter, never on it.
    expect(blur()).not.toBeNull();
    expect(blur()!.getAttribute("aria-hidden")).toBe("true");
    expect(blur()!.className).toContain("hold-slider-blur");
    expect(blur()!.className).toContain("pointer-events-none");
    expect(
      blur()!.compareDocumentPosition(scrim()!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    up();
    expect(scrim()).toBeNull();
    expect(blur()).toBeNull();
  });

  it("conceals the pill while the capsule is up — the track replaces it", () => {
    render(<Host />);
    const wrapper = pill().parentElement!;
    expect(wrapper.className).not.toContain("opacity-0");
    down();
    hold();
    expect(wrapper.className).toContain("opacity-0");
    up();
    expect(wrapper.className).not.toContain("opacity-0");
  });

  it("expands in the same home regardless of where the press landed", () => {
    render(<Host />);
    down({ clientX: 100 });
    hold();
    const firstLeft = overlay()!.style.left;
    fireEvent.pointerUp(pill(), { pointerId: 1, clientX: 100, clientY: 400 });
    expect(overlay()).toBeNull();
    fireEvent.pointerDown(pill(), {
      pointerId: 1,
      clientX: 800,
      clientY: 400,
      button: 0,
    });
    hold();
    expect(overlay()!.style.left).toBe(firstLeft);
    fireEvent.pointerUp(pill(), { pointerId: 1, clientX: 800, clientY: 400 });
  });

  it("rides a thumb on the dragged detent, tone in its core", () => {
    render(<Host />);
    down();
    hold();
    const thumb = () =>
      overlay()!.querySelector<HTMLElement>("[data-hold-slider-thumb]")!;
    const dots = () => overlay()!.querySelectorAll<HTMLElement>("[data-detent-dot]");
    expect(thumb()).not.toBeNull();
    expect(thumb().className).toContain("hold-slider-thumb");
    // On the anchor (Auto, faint) — centered on detent 0's x.
    expect(thumb().style.left).toBe(dots()[0]!.style.left);
    moveTo(DOWN_X + 2 * DETENT_SPACING_PX);
    expect(thumb().style.left).toBe(dots()[2]!.style.left);
    expect(thumb().querySelector("span")!.className).toContain("bg-laser");
    moveTo(DOWN_X + 4 * DETENT_SPACING_PX);
    expect(thumb().querySelector("span")!.className).toContain("bg-ultra");
    up(DOWN_X + 4 * DETENT_SPACING_PX);
    expect(overlay()).toBeNull();
  });

  it("stands down when the press wanders vertically past slop before the hold", () => {
    const onCommit = vi.fn();
    const onOpen = vi.fn();
    render(<Host onCommit={onCommit} onOpen={onOpen} />);
    // A mouse has no implicit capture, so a lift outside the wrapper would
    // never reach it — the stand-down must claim the pointer or the press
    // record leaks and the wrapper is inert until remount.
    const capture = vi.fn();
    pill().parentElement!.setPointerCapture = capture;
    down();
    moveTo(DOWN_X, 400 + SLOP_PX + 4);
    hold();
    expect(overlay()).toBeNull();
    expect(capture).toHaveBeenCalledWith(1);
    up();
    expect(onCommit).not.toHaveBeenCalled();
    // A mouse release over the pill fires a browser click regardless of
    // travel — a press classified as not-a-tap must not open the sheet
    // (Codex review, PR #99; the use-swipe-actions rule).
    fireEvent.click(pill());
    expect(onOpen).not.toHaveBeenCalled();
    // The suppression is one-shot: once its same-task reset runs, the NEXT
    // press is an ordinary tap.
    vi.advanceTimersByTime(0);
    down();
    up();
    fireEvent.click(pill());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("engages on a sideways slide at once — the reference gesture never waits out the timer", () => {
    const onCommit = vi.fn();
    const onOpen = vi.fn();
    render(<Host onCommit={onCommit} onOpen={onOpen} />);
    down();
    // Past slop, x-dominant, long before HOLD_MS: the slide IS the gesture.
    // Treating it as a departure is what read on-device as "the slider never
    // appears" (2026-08-09) — the press was quietly discarded instead.
    moveTo(DOWN_X + SLOP_PX + 4);
    expect(overlay()).not.toBeNull();
    // The same unbroken motion drags on and commits normally.
    moveTo(DOWN_X + 2 * DETENT_SPACING_PX);
    up(DOWN_X + 2 * DETENT_SPACING_PX);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(2);
    expect(overlay()).toBeNull();
    fireEvent.click(pill());
    expect(onOpen).not.toHaveBeenCalled();
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

  it("claims pinch-zoom while enabled — pans stay off the UA, zoom stays native", () => {
    // NOT `pan-y pinch-zoom`: touch-action is consulted once, at gesture
    // start, so the pre-hold window is defensible only from this resting
    // value — under `pan-y` the UA stayed free to read a pre-hold vertical
    // drift as a scroll and end the press with pointercancel. And never
    // `none`, the value that killed zoom app-wide once (zoom-and-share).
    render(<Host />);
    expect(pill().parentElement!.style.touchAction).toBe("pinch-zoom");
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

  it("keeps the drag relative to the finger from the fixed home", () => {
    // The finger presses near the pill's edge while the track sits in its
    // centered home, so the finger never starts over the selected detent.
    // The first shipped cut mapped absolute x and teleported Auto → Max on
    // the first move (caught by the e2e drag in mobile emulation);
    // dragOffset keeps travel relative, wherever the home is.
    const onCommit = vi.fn();
    render(<Host onCommit={onCommit} />);
    const descriptor = Object.getOwnPropertyDescriptor(window, "innerWidth");
    Object.defineProperty(window, "innerWidth", {
      value: 375,
      configurable: true,
    });
    try {
      fireEvent.pointerDown(pill(), {
        pointerId: 1,
        clientX: 340,
        clientY: 400,
        button: 0,
      });
      hold();
      moveTo(340 + DETENT_SPACING_PX);
      up(340 + DETENT_SPACING_PX);
      expect(onCommit).toHaveBeenCalledExactlyOnceWith(1);
    } finally {
      if (descriptor) Object.defineProperty(window, "innerWidth", descriptor);
    }
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

  it("shows the level readout and tone for the detent under the finger", () => {
    render(<Host />);
    down();
    hold();
    moveTo(DOWN_X + 4 * DETENT_SPACING_PX);
    const el = overlay()!;
    // Level only — the model qualifier belongs to the announce string, not
    // to a chip floating next to the rail that already names the model.
    expect(el.textContent).toContain("Extra High");
    expect(el.textContent).not.toContain("Fable 5");
    expect(el.querySelector("[data-tone]")!.getAttribute("data-tone")).toBe("ultra");
  });

  it("announces the committed value through the live region", () => {
    render(<Host />);
    // Located by hook, not role: role=status is deliberately absent (the
    // result view's tests own the singular status query).
    const region = document.querySelector("[data-hold-slider-announce]")!;
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
    down();
    hold();
    moveTo(DOWN_X + 5 * DETENT_SPACING_PX);
    up(DOWN_X + 5 * DETENT_SPACING_PX);
    expect(region.textContent).toBe("Fable 5 · Max");
  });
});

describe("detent marker vocabulary", () => {
  it("renders equal dots by default, visible only ahead of the fill", () => {
    render(<Host selectedIndex={2} />);
    down();
    hold();
    const dots = overlay()!.querySelectorAll<HTMLElement>("[data-detent-dot]");
    expect(dots).toHaveLength(DETENTS.length);
    expect(overlay()!.querySelector("[data-detent-bar]")).toBeNull();
    // Equal: dots carry no per-detent shape — the fill width is the readout.
    const sizes = new Set([...dots].map((d) => d.style.height));
    expect(sizes.size).toBe(1);
    // Reached dots go transparent (dark dots in the laser fill read as
    // sediment; the fill edge marks the position) but STAY in the DOM, so
    // detent-id enumeration never depends on the drag position.
    [...dots].forEach((d, i) => {
      if (i <= 2) expect(d.className).toContain("opacity-0");
      else expect(d.className).not.toContain("opacity-0");
    });
    up();
  });

  it("renders ascending bars under detentMarker='bar'", () => {
    render(<Host detentMarker="bar" />);
    down();
    hold();
    expect(overlay()!.querySelector("[data-detent-dot]")).toBeNull();
    const bars = overlay()!.querySelectorAll<HTMLElement>("[data-detent-bar]");
    expect(bars).toHaveLength(DETENTS.length);
    const heights = [...bars].map((b) => parseFloat(b.style.height));
    // Strictly ascending — the ladder's shape, legible in the ticks.
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]!).toBeGreaterThan(heights[i - 1]!);
    }
    // Unlike dots, reached bars stay visible: a meter IS its filled bars.
    [...bars].forEach((b) => expect(b.className).not.toContain("opacity-0"));
    up();
  });
});

describe("portal-bubbled presses stay inert", () => {
  /**
   * The wrapper's children include each picker's SHEET, which portals to
   * document.body — and React re-dispatches a portalled child's events up
   * the COMPONENT tree, so a press anywhere in the open sheet reaches the
   * wrapper's handlers too. A gesture may only begin in the wrapper's own
   * DOM subtree; without that admission rule, holding the Target sheet's
   * Auto card grew the capsule across the open sheet, release committed a
   * preference nobody chose, and the trailing-click suppression ate the
   * row's own tap (2026-08-10). The guard must be containment, not identity
   * — every legitimate press targets the pill, a DOM descendant — or the
   * pill-press suites above would go red.
   */
  function PortalHost({
    onCommit = () => {},
    onRow = () => {},
  }: {
    onCommit?: (i: number) => void;
    onRow?: () => void;
  }) {
    return (
      <HoldSliderTrigger
        detents={DETENTS}
        selectedIndex={0}
        liveLabel={liveLabel}
        onCommit={onCommit}
        enabled
      >
        <button type="button">Pill</button>
        {createPortal(
          <button type="button" onClick={onRow}>
            Row
          </button>,
          document.body,
        )}
      </HoldSliderTrigger>
    );
  }
  const row = () => screen.getByRole("button", { name: "Row" });
  const downOnRow = () =>
    fireEvent.pointerDown(row(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });

  it("never engages from a hold that began in a portalled child", () => {
    const onCommit = vi.fn();
    const onRow = vi.fn();
    render(<PortalHost onCommit={onCommit} onRow={onRow} />);
    downOnRow();
    hold();
    expect(overlay()).toBeNull();
    fireEvent.pointerUp(row(), { pointerId: 1, clientX: DOWN_X, clientY: 400 });
    expect(onCommit).not.toHaveBeenCalled();
    // No press record was ever admitted, so no click suppression either —
    // the row's own tap must land.
    fireEvent.click(row());
    expect(onRow).toHaveBeenCalledTimes(1);
  });

  it("never engages from a press-and-slide that began in a portalled child", () => {
    const onCommit = vi.fn();
    const onRow = vi.fn();
    render(<PortalHost onCommit={onCommit} onRow={onRow} />);
    downOnRow();
    // X-dominant past slop — on the pill this engages at once.
    fireEvent.pointerMove(row(), {
      pointerId: 1,
      clientX: DOWN_X + SLOP_PX + 4,
      clientY: 400,
    });
    expect(overlay()).toBeNull();
    fireEvent.pointerUp(row(), {
      pointerId: 1,
      clientX: DOWN_X + SLOP_PX + 4,
      clientY: 400,
    });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.click(row());
    expect(onRow).toHaveBeenCalledTimes(1);
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

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
  dynamicBackdrop,
}: {
  enabled?: boolean;
  selectedIndex?: number;
  onCommit?: (i: number) => void;
  onOpen?: () => void;
  detentMarker?: DetentMarker;
  dynamicBackdrop?: boolean;
}) {
  return (
    <HoldSliderTrigger
      detents={DETENTS}
      selectedIndex={selectedIndex}
      liveLabel={liveLabel}
      onCommit={onCommit}
      enabled={enabled}
      detentMarker={detentMarker}
      dynamicBackdrop={dynamicBackdrop}
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
    const frozen = () => document.documentElement.hasAttribute("data-hold-gesture");
    expect(scrim()).toBeNull();
    expect(blur()).toBeNull();
    expect(frozen()).toBe(false);
    down();
    hold();
    // The world pauses under the gesture: this attribute is what freezes
    // the ambient field (nebula canvas gate + bloom play-state), keeping
    // the blur's backdrop static — the one-time-filter claim's enforcer.
    expect(frozen()).toBe(true);
    expect(scrim()).not.toBeNull();
    expect(scrim()!.getAttribute("aria-hidden")).toBe("true");
    // pointer-events AUTO: the pair doubles as the gesture's input shield —
    // a second pointer mid-gesture dies on it instead of reaching a control
    // beneath (ninth pass). The gesture's own pointer is captured, so the
    // shield can never steal the drag it guards.
    expect(scrim()!.className).toContain("pointer-events-auto");
    // The blur layer is the static half of the pair: its class carries the
    // backdrop-filter (stand-downs strip it in CSS), and it must precede
    // the dim in the DOM so the fade rides ABOVE the filter, never on it.
    expect(blur()).not.toBeNull();
    expect(blur()!.getAttribute("aria-hidden")).toBe("true");
    expect(blur()!.className).toContain("hold-slider-blur");
    expect(blur()!.className).toContain("pointer-events-auto");
    expect(
      blur()!.compareDocumentPosition(scrim()!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    up();
    expect(scrim()).toBeNull();
    expect(blur()).toBeNull();
    expect(frozen()).toBe(false);
  });

  it("stands the blur down over a declared dynamic backdrop — dim only", () => {
    // The blur's performance case is a STATIC backdrop filtered once. The
    // world-pause freezes the idle ornaments, but a streaming run's surface
    // is content that must keep repainting — so the consumer declares the
    // backdrop dynamic and the gesture ships the dim alone (the stand-down
    // presentation), rather than a filter re-priced every frame (Codex
    // review, eighth pass; the 2026-08-09 bloom mechanism).
    const onCommit = vi.fn();
    render(<Host dynamicBackdrop onCommit={onCommit} />);
    down();
    hold();
    expect(document.querySelector("[data-hold-slider-blur]")).toBeNull();
    expect(document.querySelector("[data-hold-slider-scrim]")).not.toBeNull();
    expect(overlay()).not.toBeNull();
    // The freeze attribute still stamps — the idle-ornament pause is
    // independent of whether the blur shipped.
    expect(document.documentElement.hasAttribute("data-hold-gesture")).toBe(true);
    // The gesture itself is untouched: drag and commit as ever.
    moveTo(DOWN_X + DETENT_SPACING_PX);
    up(DOWN_X + DETENT_SPACING_PX);
    expect(onCommit).toHaveBeenCalledWith(1);
    expect(document.querySelector("[data-hold-slider-scrim]")).toBeNull();
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
    // Escape's teardown also thaws the ambient field.
    expect(document.documentElement.hasAttribute("data-hold-gesture")).toBe(false);
    // The finger lifts much later — no commit, and no phantom sheet-open.
    vi.advanceTimersByTime(2000);
    up();
    fireEvent.click(pill());
    expect(onCommit).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("swallows every unmodified key while the capsule is up — keyboard is a channel too", () => {
    // The focus pair shields pointers; a background control left
    // keyboard-focused still activated on Enter/Space and opened its sheet
    // under the live capsule (fourteenth pass) — and an enumeration of
    // "activation keys" was itself the next hole: arrows and paging keys
    // scroll the document beneath the frozen world, Tab wanders focus
    // (modality audit). While active, every unmodified key dies at the
    // window's capture phase, keydown and keyup both; modifier chords
    // belong to the browser and pass; Escape stays the one designed key;
    // and at rest every key passes untouched.
    render(<Host />);
    expect(fireEvent.keyDown(document.body, { key: "Enter" })).toBe(true);
    down();
    hold();
    expect(fireEvent.keyDown(document.body, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyUp(document.body, { key: " " })).toBe(false);
    expect(fireEvent.keyDown(document.body, { key: "ArrowDown" })).toBe(false);
    expect(fireEvent.keyDown(document.body, { key: "Tab" })).toBe(false);
    expect(fireEvent.keyDown(document.body, { key: "PageDown" })).toBe(false);
    // Chords pass — except on the activation keys, which still run a
    // focused button's native activation under Ctrl/Meta (fifteenth pass).
    expect(fireEvent.keyDown(document.body, { key: "c", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true })).toBe(false);
    expect(fireEvent.keyDown(document.body, { key: " ", metaKey: true })).toBe(false);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(overlay()).toBeNull();
    up();
    expect(fireEvent.keyDown(document.body, { key: "Enter" })).toBe(true);
  });

  it("blocks wheel scrolling while the capsule is up", () => {
    // The scrim is not scrollable, but a wheel over it must not glide the
    // document beneath the frozen world either (modality audit) — the
    // same claim the touchmove block makes for fingers.
    render(<Host />);
    expect(fireEvent.wheel(window, { deltaY: 40 })).toBe(true);
    down();
    hold();
    expect(fireEvent.wheel(window, { deltaY: 40 })).toBe(false);
    up();
    expect(fireEvent.wheel(window, { deltaY: 40 })).toBe(true);
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

describe("one gesture at a time, app-wide", () => {
  /**
   * The two composer rails sit adjacent and both can be enabled, so two
   * fingers could otherwise run two gestures at once — stacked focus pairs,
   * and a shared `data-hold-gesture` attribute whose FIRST teardown thawed
   * the world under the survivor's blur (Codex review, seventh pass).
   * Admission is exclusive at pointer-down: while any pill's press is live,
   * a second pill's press is refused outright — no press record, no hold
   * timer — and refused WHOLE: its synthesized click is consumed for the
   * claim's lifetime (ninth pass; the seventh's tap fall-through opened
   * the other sheet under the live capsule on hybrid inputs). The claim
   * dies with the press that holds it: up, cancel, or unmount.
   */
  function TwinHosts({
    onCommitA = () => {},
    onCommitB = () => {},
    onOpenA = () => {},
    onOpenB = () => {},
    showA = true,
  }: {
    onCommitA?: (i: number) => void;
    onCommitB?: (i: number) => void;
    onOpenA?: () => void;
    onOpenB?: () => void;
    showA?: boolean;
  }) {
    return (
      <>
        {showA && (
          <HoldSliderTrigger
            detents={DETENTS}
            selectedIndex={0}
            liveLabel={liveLabel}
            onCommit={onCommitA}
            enabled
          >
            <button type="button" onClick={onOpenA}>
              A
            </button>
          </HoldSliderTrigger>
        )}
        <HoldSliderTrigger
          detents={DETENTS}
          selectedIndex={0}
          liveLabel={liveLabel}
          onCommit={onCommitB}
          enabled
        >
          <button type="button" onClick={onOpenB}>
            B
          </button>
        </HoldSliderTrigger>
      </>
    );
  }
  const pillA = () => screen.getByRole("button", { name: "A" });
  const pillB = () => screen.getByRole("button", { name: "B" });
  const overlays = () =>
    document.querySelectorAll<HTMLElement>("[data-hold-slider-overlay]");
  const frozen = () => document.documentElement.hasAttribute("data-hold-gesture");
  const downOn = (el: HTMLElement, pointerId: number) =>
    fireEvent.pointerDown(el, {
      pointerId,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });

  it("refuses a second pill's press while a gesture is live — and its release never thaws the survivor", () => {
    const onCommitA = vi.fn();
    const onCommitB = vi.fn();
    const onOpenB = vi.fn();
    render(<TwinHosts onCommitA={onCommitA} onCommitB={onCommitB} onOpenB={onOpenB} />);
    downOn(pillA(), 1);
    hold();
    expect(overlays()).toHaveLength(1);
    expect(frozen()).toBe(true);
    // A second finger presses the other pill mid-drag: refused at admission,
    // so its own hold timer never even starts.
    downOn(pillB(), 2);
    hold();
    expect(overlays()).toHaveLength(1);
    // The refused finger lifts. THE regression this guards: without
    // exclusive admission, B's teardown stripped the shared attribute and
    // the ambient field thawed beneath A's still-live blur.
    fireEvent.pointerUp(pillB(), { pointerId: 2, clientX: DOWN_X, clientY: 400 });
    expect(frozen()).toBe(true);
    expect(overlays()).toHaveLength(1);
    // The refusal is WHOLE (ninth pass, superseding the seventh's tap
    // fall-through): B's synthesized click is consumed while A's claim is
    // live — on hybrid inputs that click otherwise opened B's sheet under
    // A's capsule, the state the admission guard exists to prevent.
    fireEvent.click(pillB());
    expect(onOpenB).not.toHaveBeenCalled();
    // A's gesture is untouched throughout: drag one detent and commit.
    fireEvent.pointerMove(pillA(), {
      pointerId: 1,
      clientX: DOWN_X + DETENT_SPACING_PX,
      clientY: 400,
    });
    fireEvent.pointerUp(pillA(), {
      pointerId: 1,
      clientX: DOWN_X + DETENT_SPACING_PX,
      clientY: 400,
    });
    expect(onCommitA).toHaveBeenCalledTimes(1);
    expect(onCommitA).toHaveBeenCalledWith(1);
    expect(onCommitB).not.toHaveBeenCalled();
    expect(overlays()).toHaveLength(0);
    expect(frozen()).toBe(false);
    // The claim died with A's press — B's tap now passes untouched.
    fireEvent.click(pillB());
    expect(onOpenB).toHaveBeenCalledTimes(1);
  });

  it("consumes the other pill's click for the whole claim window — before the hold even fires", () => {
    // The claim is taken at pointer-DOWN, so the consumption must cover the
    // pre-hold window too: a second finger's tap inside A's 300ms would
    // otherwise open B's sheet, and A's capsule then mounted over it.
    const onOpenB = vi.fn();
    render(<TwinHosts onOpenB={onOpenB} />);
    downOn(pillA(), 1);
    fireEvent.click(pillB());
    expect(onOpenB).not.toHaveBeenCalled();
    hold();
    expect(overlays()).toHaveLength(1);
    fireEvent.pointerUp(pillA(), { pointerId: 1, clientX: DOWN_X, clientY: 400 });
    fireEvent.click(pillB());
    expect(onOpenB).toHaveBeenCalledTimes(1);
  });

  it("releases the claim with the press — the other pill gestures normally afterward", () => {
    const onCommitA = vi.fn();
    const onCommitB = vi.fn();
    render(<TwinHosts onCommitA={onCommitA} onCommitB={onCommitB} />);
    downOn(pillA(), 1);
    hold();
    fireEvent.pointerUp(pillA(), { pointerId: 1, clientX: DOWN_X, clientY: 400 });
    expect(onCommitA).toHaveBeenCalledTimes(1);
    downOn(pillB(), 2);
    hold();
    expect(overlays()).toHaveLength(1);
    fireEvent.pointerUp(pillB(), { pointerId: 2, clientX: DOWN_X, clientY: 400 });
    expect(onCommitB).toHaveBeenCalledTimes(1);
    expect(frozen()).toBe(false);
  });

  it("consumes a second device's click on the pill that OWNS the press", () => {
    // The ninth pass exempted the owner's own claim, and the tenth closed
    // it: a mouse click can land inside a touch press's pre-hold window,
    // and Enter can activate the focused pill mid-drag — with the claim
    // live, a click on the owning pill is never its plain tap. The plain
    // tap stays safe by protocol order, not identity: pointer-up releases
    // the claim before the browser dispatches the click.
    const onOpen = vi.fn();
    const onCommit = vi.fn();
    render(<Host onOpen={onOpen} onCommit={onCommit} />);
    down();
    fireEvent.click(pill()); // second device, inside the pre-hold window
    expect(onOpen).not.toHaveBeenCalled();
    hold(); // the press was untouched — the gesture engages as ever
    expect(overlay()).not.toBeNull();
    fireEvent.click(pill()); // Enter mid-drag
    expect(onOpen).not.toHaveBeenCalled();
    moveTo(DOWN_X + DETENT_SPACING_PX);
    up(DOWN_X + DETENT_SPACING_PX);
    expect(onCommit).toHaveBeenCalledWith(1);
    act(() => {
      vi.advanceTimersByTime(1); // settle() clears the commit's suppression
    });
    // At rest the ordinary tap path is untouched.
    down();
    up();
    fireEvent.click(pill());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("ends the press on a lift the wrapper never hears — no phantom activation", () => {
    // A mouse is not implicitly captured: an edge press can leave the
    // wrapper inside the slop window, and every later event — the lift
    // included — dispatches elsewhere. Pre-fix the hold timer fired on the
    // stale press: a phantom overlay, freeze, and input shield with no
    // pointer down, and the claim held until remount (twelfth pass). The
    // window net hears the outside lift and ends the press cleanly.
    const onCommitA = vi.fn();
    const onOpenB = vi.fn();
    render(<TwinHosts onCommitA={onCommitA} onOpenB={onOpenB} />);
    downOn(pillA(), 1);
    fireEvent.pointerUp(document.body, {
      pointerId: 1,
      clientX: 500,
      clientY: 600,
    });
    hold(); // the timer must already be dead
    expect(overlays()).toHaveLength(0);
    expect(frozen()).toBe(false);
    expect(onCommitA).not.toHaveBeenCalled();
    // The claim died with the press: the other pill gestures and taps.
    downOn(pillB(), 2);
    hold();
    expect(overlays()).toHaveLength(1);
    fireEvent.pointerUp(pillB(), { pointerId: 2, clientX: DOWN_X, clientY: 400 });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    fireEvent.click(pillB());
    expect(onOpenB).toHaveBeenCalledTimes(1);
  });

  it("keeps a refused press refused even when the owner releases first", () => {
    // The claim alone cannot carry the refusal to its end: touch owns A,
    // mouse-down on B is refused, then A commits and releases the claim
    // BEFORE the mouse lifts — at B's click time both the claim and B's
    // suppressClick were clear, and the press documented as refused whole
    // opened B's sheet (thirteenth pass). The per-instance marker survives
    // the owner's release and dies with the refused stream's own click.
    const onOpenB = vi.fn();
    render(<TwinHosts onOpenB={onOpenB} />);
    downOn(pillA(), 1);
    hold();
    downOn(pillB(), 2); // refused — foreign claim
    fireEvent.pointerUp(pillA(), { pointerId: 1, clientX: DOWN_X, clientY: 400 });
    act(() => {
      vi.advanceTimersByTime(1); // A's settle clears A's own suppression
    });
    fireEvent.pointerUp(pillB(), { pointerId: 2, clientX: DOWN_X, clientY: 400 });
    fireEvent.click(pillB()); // the refused stream's click, post-claim
    expect(onOpenB).not.toHaveBeenCalled();
    // The refusal ended with its stream: a fresh tap on B works.
    downOn(pillB(), 2);
    fireEvent.pointerUp(pillB(), { pointerId: 2, clientX: DOWN_X, clientY: 400 });
    fireEvent.click(pillB());
    expect(onOpenB).toHaveBeenCalledTimes(1);
  });

  it("stands down at activation when a sheet opened during the pre-hold window", () => {
    // The admission guard stops gestures BEGINNING over a sheet; this is
    // the symmetric half (thirteenth pass): the input shield mounts only at
    // activation, so a second device can open a sheet through a
    // non-wrapped trigger inside the 300ms window. The sheet is senior —
    // the hold stands down like a y-dominant scroll instead of mounting
    // the capsule over it.
    const onCommit = vi.fn();
    const onOpen = vi.fn();
    render(<Host onCommit={onCommit} onOpen={onOpen} />);
    down();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    hold(); // the timer fires into the probe
    expect(overlay()).toBeNull();
    expect(document.documentElement.hasAttribute("data-hold-gesture")).toBe(false);
    up();
    fireEvent.click(pill());
    expect(onCommit).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled(); // the lift's click is swallowed
    dialog.remove();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    // Sheet gone — the control is fresh.
    down();
    hold();
    expect(overlay()).not.toBeNull();
    up();
  });

  it("a refusal dies with its own stream — a stale marker never eats a keyboard click", () => {
    // A refused pointer that releases OUTSIDE this wrapper never sends the
    // click the marker waits for; pre-fix the stale marker then ate the
    // pill's next keyboard or programmatic click — an activation a
    // keyboard user must never lose (Vercel agent review, fourteenth
    // round). The window end-watch hears the stream end anywhere and the
    // marker clears one task later.
    const onOpenB = vi.fn();
    render(<TwinHosts onOpenB={onOpenB} />);
    downOn(pillA(), 1);
    hold();
    downOn(pillB(), 2); // refused — marker armed
    fireEvent.pointerUp(pillA(), { pointerId: 1, clientX: DOWN_X, clientY: 400 });
    // The refused pointer releases far from B — no click will ever come.
    fireEvent.pointerUp(document.body, { pointerId: 2, clientX: 500, clientY: 600 });
    act(() => {
      vi.advanceTimersByTime(1); // the end-watch's zero-timeout clears the marker
    });
    // The next activation is keyboard/programmatic: a bare click, no
    // pointer-down to supersede anything. It must land.
    fireEvent.click(pillB());
    expect(onOpenB).toHaveBeenCalledTimes(1);
  });

  it("reverts on window blur — the world never stays frozen in a background tab", () => {
    // An alt-tab, app switch, or locked phone mid-gesture delivers NO
    // event to this document: the mouse releases in another window and
    // the up never dispatches here — the one ending no pointer net can
    // catch (modality audit). Concealment is a pointercancel: revert,
    // never commit, everything released.
    const onCommitA = vi.fn();
    const onOpenA = vi.fn();
    const onOpenB = vi.fn();
    render(<TwinHosts onCommitA={onCommitA} onOpenA={onOpenA} onOpenB={onOpenB} />);
    downOn(pillA(), 1);
    hold();
    expect(overlays()).toHaveLength(1);
    fireEvent.blur(window);
    expect(overlays()).toHaveLength(0);
    expect(frozen()).toBe(false);
    expect(onCommitA).not.toHaveBeenCalled();
    // The concealed stream is abandoned, not finished: the user returns
    // and lifts over the pill — capture survived, the click synthesizes
    // minutes later, and it must die with ITS stream, not open the sheet
    // after a revert (fifteenth pass).
    fireEvent.pointerUp(pillA(), { pointerId: 1, clientX: DOWN_X, clientY: 400 });
    fireEvent.click(pillA());
    expect(onOpenA).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    // The claim died with the press: the other pill lives…
    downOn(pillB(), 2);
    hold();
    expect(overlays()).toHaveLength(1);
    fireEvent.pointerUp(pillB(), { pointerId: 2, clientX: DOWN_X, clientY: 400 });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    fireEvent.click(pillB());
    expect(onOpenB).toHaveBeenCalledTimes(1);
    // …and so does the concealed pill itself, on its next fresh tap.
    downOn(pillA(), 1);
    fireEvent.pointerUp(pillA(), { pointerId: 1, clientX: DOWN_X, clientY: 400 });
    fireEvent.click(pillA());
    expect(onOpenA).toHaveBeenCalledTimes(1);
  });

  it("the conceal watch itself expires on return — a pointer that died in another app cannot eat a keyboard click", () => {
    // The concealed stream's end-watch waits for a pointerup that a
    // release in another application never sends (sixteenth pass — the
    // fourteenth's expiry lesson, violated by its own reuse). Foreground
    // return is the horizon: after refocus the revert is long visible and
    // the pill's first keyboard activation must land.
    const onOpenA = vi.fn();
    render(<TwinHosts onOpenA={onOpenA} />);
    downOn(pillA(), 1);
    hold();
    fireEvent.blur(window); // conceal: revert + marker + watch
    expect(overlays()).toHaveLength(0);
    // The pointer releases in the other app — no event ever arrives.
    fireEvent.focus(window); // the user comes back
    act(() => {
      vi.advanceTimersByTime(1);
    });
    fireEvent.click(pillA()); // keyboard activation: no pointer-down first
    expect(onOpenA).toHaveBeenCalledTimes(1);
  });

  it("releases the claim on unmount — a dead owner never bricks the surviving sliders", () => {
    const onCommitB = vi.fn();
    const { rerender } = render(<TwinHosts onCommitB={onCommitB} />);
    downOn(pillA(), 1);
    hold();
    expect(overlays()).toHaveLength(1);
    rerender(<TwinHosts onCommitB={onCommitB} showA={false} />);
    expect(overlays()).toHaveLength(0);
    expect(frozen()).toBe(false);
    downOn(pillB(), 2);
    hold();
    expect(overlays()).toHaveLength(1);
    fireEvent.pointerUp(pillB(), { pointerId: 2, clientX: DOWN_X, clientY: 400 });
    expect(onCommitB).toHaveBeenCalledTimes(1);
  });
});

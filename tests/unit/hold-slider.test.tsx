import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import {
  HoldSliderHint,
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
  compactHalo,
  latchOnTap,
  peakCaption,
}: {
  enabled?: boolean;
  selectedIndex?: number;
  onCommit?: (i: number) => void;
  onOpen?: () => void;
  detentMarker?: DetentMarker;
  dynamicBackdrop?: boolean;
  compactHalo?: boolean;
  latchOnTap?: boolean;
  peakCaption?: string | null;
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
      compactHalo={compactHalo}
      latchOnTap={latchOnTap}
      peakCaption={peakCaption}
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
  /** A trigger centered at x=512 on the 1024px viewport the tests below use,
   *  so an unclamped anchored home and a region-centered one COINCIDE — the
   *  phone case, where the composer pill sits within a hair of the region's
   *  center. Tests that care about the anchor move it deliberately. */
  const rect = { left: 468, top: 500, width: 88, height: 44 };
  const anchoredAt = (centerX: number) => ({
    left: centerX - 44,
    top: 500,
    width: 88,
    height: 44,
  });

  const wholeViewport = (width: number) => ({ left: 0, width });

  it("opens centered on its TRIGGER, on the trigger's row", () => {
    // ADR-0014: the capsule's home is the button that owns it, both axes, so
    // it reads as that button expanding in place. (ADR-0012 amendment 4 had
    // a viewport-centered home; the property it was actually defending —
    // placement never depends on where the PRESS landed — is unchanged, and
    // is what the last assertion here pins.)
    const geo = computeTrackGeometry(rect, 6, wholeViewport(1024));
    expect(geo.width).toBe(5 * DETENT_SPACING_PX + 2 * TRACK_PAD_PX);
    expect(geo.left).toBe(512 - geo.width / 2);
    expect(geo.top).toBe(500 + rect.height / 2 - geo.height / 2);
    expect(geo.detentCenters).toHaveLength(6);
    expect(geo.detentCenters[0]).toBe(geo.left + TRACK_PAD_PX);
    // Even spacing, ascending.
    expect(geo.detentCenters[3]! - geo.detentCenters[2]!).toBe(DETENT_SPACING_PX);
    // A trigger elsewhere takes its capsule with it — and the SELECTION is
    // still not an input to the geometry at all, in any mode.
    const moved = computeTrackGeometry(anchoredAt(300), 6, wholeViewport(1024));
    expect(moved.left).toBe(300 - moved.width / 2);
    expect(moved.width).toBe(geo.width);
  });

  it("clamps an edge-hugging trigger's capsule inside the margins", () => {
    // The budget dial sits inset in a side sheet, and a trigger near a
    // viewport edge would otherwise open a capsule half off-screen — which
    // is the state that makes far detents unreachable, since a pointer
    // cannot travel past the edge.
    const geo = computeTrackGeometry(anchoredAt(20), 6, wholeViewport(390));
    expect(geo.left).toBe(EDGE_MARGIN_PX);
    const right = computeTrackGeometry(anchoredAt(380), 6, wholeViewport(390));
    expect(right.left + right.width).toBe(390 - EDGE_MARGIN_PX);
    for (const center of right.detentCenters) {
      expect(center).toBeGreaterThanOrEqual(0);
      expect(center).toBeLessThanOrEqual(390);
    }
  });

  it("opens inside the VISUAL viewport under pinch zoom", () => {
    // The control preserves native pinch zoom, and a fixed-position capsule
    // can open entirely outside a zoomed-in user's view (Codex review, PR
    // #103). The caller passes the visual viewport's offset/width; the home
    // must sit inside that region even when the trigger itself is outside
    // it — the clamp, not the anchor, is what guarantees that.
    const geo = computeTrackGeometry(anchoredAt(60), 3, { left: 300, width: 200 });
    expect(geo.width).toBe(2 * DETENT_SPACING_PX + 2 * TRACK_PAD_PX);
    expect(geo.left).toBe(300 + EDGE_MARGIN_PX);
    expect(geo.left).toBeGreaterThanOrEqual(300);
    expect(geo.left + geo.width).toBeLessThanOrEqual(500);
  });

  it("compresses the ladder to fit a narrow region — every detent reachable", () => {
    // Codex review, third pass: a placement frozen around the selected
    // detent kept the SPAWN visible but let the drag walk the thumb out of
    // a region narrower than the track. Compressed spacing removes the
    // edge entirely: the whole ladder fits, and zoom multiplies physical
    // travel so the tighter detents cost no precision.
    const region = { left: 300, width: 200 };
    const geo = computeTrackGeometry(anchoredAt(400), 6, region);
    const spacing = geo.detentCenters[1]! - geo.detentCenters[0]!;
    expect(spacing).toBeCloseTo(124 / 5, 5); // (200 - 2·16 - 2·22) / 5
    expect(geo.width).toBeCloseTo(5 * spacing + 2 * TRACK_PAD_PX, 5);
    // Compressed to EXACTLY the margins, so the clamp pins it — an anchored
    // home has nowhere left to move, which is the proof that a compressed
    // capsule can never overflow the region.
    expect(geo.left).toBeCloseTo(300 + EDGE_MARGIN_PX, 5);
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
    const geo = computeTrackGeometry(anchoredAt(340), 6, region);
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
    // ladder compresses to fit inside the margins instead, which leaves the
    // clamp pinning it there whatever the anchor.
    const narrow = computeTrackGeometry(anchoredAt(180), 8, wholeViewport(360));
    const spacing = narrow.detentCenters[1]! - narrow.detentCenters[0]!;
    expect(spacing).toBeCloseTo((360 - 32 - 44) / 7, 5);
    expect(narrow.width).toBeLessThanOrEqual(360 - 2 * EDGE_MARGIN_PX);
    expect(narrow.left).toBeCloseTo(EDGE_MARGIN_PX, 5);
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

  /**
   * jsdom has no layout, so every rect is zeros and the capsule lands at the
   * very top of the region — where the halo's clamp correctly collapses it to
   * the floor. These tests are about the halo's SIZE, so they need a trigger
   * that sits somewhere plausible: the composer pill's real measured rect on
   * the 393×660 target, with the region to match. Restores on teardown.
   */
  const PILL_RECT = { x: 239, y: 345, width: 125, height: 44 } as const;
  function withRealLayout() {
    const rect = Element.prototype.getBoundingClientRect;
    const innerHeight = window.innerHeight;
    Element.prototype.getBoundingClientRect = function () {
      return {
        ...PILL_RECT,
        left: PILL_RECT.x,
        top: PILL_RECT.y,
        right: PILL_RECT.x + PILL_RECT.width,
        bottom: PILL_RECT.y + PILL_RECT.height,
        toJSON: () => ({}),
      } as DOMRect;
    };
    Object.defineProperty(window, "innerHeight", { value: 660, configurable: true });
    return () => {
      Element.prototype.getBoundingClientRect = rect;
      Object.defineProperty(window, "innerHeight", {
        value: innerHeight,
        configurable: true,
      });
    };
  }
  const haloBox = () => {
    const el = document.querySelector<HTMLElement>("[data-hold-slider-blur]")!;
    return {
      w: Number.parseFloat(el.style.width),
      h: Number.parseFloat(el.style.height),
    };
  };

  it("clamps the halo to the region the gesture opened into", () => {
    // The reach is an absolute measurement taken on a 393×660 phone, and an
    // absolute number is only "local" relative to a region. On the 320×640
    // viewport this repo supports — and far more so under pinch zoom, where
    // the visible region can be a fraction of the layout viewport — an
    // unclamped 196px per side stops clearing the chrome bars, and the
    // treatment quietly becomes the full-screen wash it exists to replace
    // (Codex review, PR #110). `useHoldDrag` samples the visual viewport for
    // the capsule's own placement already; the halo now reads the same sample.
    const restore = withRealLayout();
    try {
      render(<Host />);
      down();
      hold();
      const roomy = haloBox().h;
      up();

      // Same trigger, a much shorter region: the halo must give way.
      Object.defineProperty(window, "innerHeight", { value: 440, configurable: true });
      down();
      hold();
      const cramped = haloBox().h;
      expect(cramped).toBeLessThan(roomy);
      // …but never past the floor, and never to nothing: under-treating is the
      // better failure than washing the page.
      expect(cramped).toBeGreaterThan(Number.parseFloat(overlay()!.style.height));
      up();
    } finally {
      restore();
    }
  });

  it("treats a halo around the capsule, not the whole viewport", () => {
    // What shipped first washed `fixed inset-0` flat — on the light theme,
    // 62% of a near-white over the entire screen (owner's red X, 2026-08-11:
    // "the entire screen shouldn't white out … it should popup and blur out
    // the direct area underneath it and that blurring fades into the area …
    // that becomes clear again").
    //
    // The two layers localize from opposite ends, and the asymmetry is the
    // contract. The DIM keeps its viewport-covering box, because that box IS
    // the input shield, and localizes in its paint — the four --dial-*
    // properties globals.css reads for its radial gradient. The BLUR
    // localizes in its BOX, which is what keeps the treatment local even on
    // an engine that ignores the mask softening its edge.
    const restore = withRealLayout();
    render(<Host />);
    down();
    hold();
    const track = overlay()!;
    const blur = document.querySelector<HTMLElement>("[data-hold-slider-blur]")!;
    const scrim = document.querySelector<HTMLElement>("[data-hold-slider-scrim]")!;
    const px = (v: string) => Number.parseFloat(v);

    // The blur is a finite box, concentric with the capsule and larger on
    // both axes. Derived from the same geometry, so this holds wherever the
    // capsule's clamp puts it.
    expect(blur.className).not.toContain("inset-0");
    const trackCx = px(track.style.left) + px(track.style.width) / 2;
    const trackCy = px(track.style.top) + px(track.style.height) / 2;
    expect(px(blur.style.left) + px(blur.style.width) / 2).toBeCloseTo(trackCx, 5);
    expect(px(blur.style.top) + px(blur.style.height) / 2).toBeCloseTo(trackCy, 5);
    expect(px(blur.style.width)).toBeGreaterThan(px(track.style.width));
    // Vertically the halo has to reach well past the floating level chip ABOVE
    // the capsule and the peak caption BELOW it — and, after the owner's
    // second pass, past the whole composer row into the prompt area, so the
    // text under and around the popup stops reading rather than merely going
    // soft. The floor is deliberately far above the two chips' ~40px: this
    // number regressing to "just clears the chips" is the shipped-too-small
    // state the second pass rejected. The real ceiling — that the box still
    // ends clear of the chrome bars — needs layout and is pinned in e2e.
    expect(px(blur.style.height)).toBeGreaterThan(px(track.style.height) + 380);
    // Wider than the viewport is CORRECT here, not a bug: the capsule clamps
    // off-centre on a phone, so the ellipse needs a horizontal radius large
    // enough that its opaque core still spans the full width from that origin.
    expect(px(blur.style.width)).toBeGreaterThan(px(track.style.width) + 380);

    // The dim keeps the shield's box and carries the centre instead.
    expect(scrim.className).toContain("fixed inset-0");
    expect(px(scrim.style.getPropertyValue("--dial-cx"))).toBeCloseTo(trackCx, 5);
    expect(px(scrim.style.getPropertyValue("--dial-cy"))).toBeCloseTo(trackCy, 5);
    // Its ellipse reaches at least as far as the blur's box, so where an
    // engine drops the mask the hard edge lands inside the wash, not on it.
    expect(px(scrim.style.getPropertyValue("--dial-rx"))).toBeGreaterThanOrEqual(
      px(blur.style.width) / 2,
    );
    expect(px(scrim.style.getPropertyValue("--dial-ry"))).toBeGreaterThanOrEqual(
      px(blur.style.height) / 2,
    );
    // No flat fill left in the component: the wash is a gradient in CSS now,
    // and this was the last hardcoded backdrop colour outside the stylesheet.
    expect(scrim.style.backgroundColor).toBe("");
    restore();
  });

  it("pulls the halo in for a capsule inside a sheet", () => {
    // The halo's reach was measured against the COMPOSER — a full page with a
    // header, a mode rail, a card and a textarea to obscure. On a ~320px sheet
    // panel the same numbers swallowed the sheet's own title, its model list,
    // and the Auto card the dial exists to tune, which is the one thing that
    // has to stay visible while you tune it (seen in capture, 2026-08-11). A
    // sheet is also already a focus surface — its own scrim handled the world
    // behind it — so the halo's job there is only the panel's surroundings.
    const restore = withRealLayout();
    const { unmount } = render(<Host />);
    down();
    hold();
    const full = haloBox();
    up();
    unmount();

    render(<Host compactHalo />);
    down();
    hold();
    const compact = haloBox();
    // Strictly smaller on both axes, and still larger than the capsule — a
    // compact halo is a smaller lens, never no lens.
    expect(compact.w).toBeLessThan(full.w);
    expect(compact.h).toBeLessThan(full.h);
    const track = overlay()!;
    expect(compact.w).toBeGreaterThan(Number.parseFloat(track.style.width));
    expect(compact.h).toBeGreaterThan(Number.parseFloat(track.style.height));
    restore();
  });

  it("puts the capsule on frosted glass with an edge shadow", () => {
    // "the popup with the blurred background and the slider has glass
    // backgrounds super opaque blurring the content and also shadows dropping
    // over at the edge blurs to give it style" — the capsule is the one
    // surface that floats over a blur of its own making, so it gets a tier of
    // its own rather than the flat `.glass-solid` chip it wore before.
    render(<Host peakCaption="Costs more" selectedIndex={DETENTS.length - 1} />);
    down();
    hold();
    const el = overlay()!;
    const capsule = el.querySelector<HTMLElement>(".hold-slider-glass")!;
    expect(capsule).not.toBeNull();
    expect(capsule.className).toContain("hold-slider-lift");
    // The frost goes on the ROUND box inside the track, never on the track
    // itself: the track is position:fixed, and a backdrop-filter on fixed
    // chrome is the iOS async-scrolling trap the chrome bars already dodge.
    expect(el.className).not.toContain("hold-slider-glass");
    // The chip and the cost caption ride the same shadow, so all three
    // floating pieces sit at one elevation over the halo.
    expect(
      el.querySelector("[data-hold-slider-label]")!.className,
    ).toContain("hold-slider-lift");
    expect(
      el.querySelector("[data-hold-slider-caption]")!.closest(".hold-slider-lift"),
    ).not.toBeNull();
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

  it("stands the CAPSULE FROST down over a dynamic backdrop too", () => {
    // `dynamicBackdrop` is a JS-side withdrawal — the halo element is simply
    // not rendered — so the two CSS stand-downs on `.hold-slider-glass` cannot
    // see it. The frost shipped without its own answer, leaving a 40px
    // backdrop-filter re-filtering the streaming result on every token frame:
    // the exact per-frame cost this prop exists to prevent, reintroduced by
    // the layer meant to stand down alongside the halo (Codex review, PR
    // #110). `.glass-solid` is what both CSS gates already collapse it to.
    const restore = withRealLayout();
    const { unmount } = render(<Host />);
    down();
    hold();
    expect(overlay()!.querySelector(".hold-slider-glass")).not.toBeNull();
    up();
    unmount();

    render(<Host dynamicBackdrop />);
    down();
    hold();
    expect(overlay()!.querySelector(".hold-slider-glass")).toBeNull();
    const capsule = overlay()!.querySelector<HTMLElement>(".glass-solid.hold-slider-lift")!;
    expect(capsule).not.toBeNull();
    up();
    restore();
  });

  it("ends the dim exactly where the blur box does, vertically", () => {
    // The spread that softens the mask-less seam is HORIZONTAL only. Applied
    // to Y it pushed the painted dim ~35px past the blur's clamped edge and
    // into the bottom nav — still around half strength there, because the fade
    // only starts at 84% — so the blur was localized and the treatment as a
    // whole was not (Codex review, PR #110).
    const restore = withRealLayout();
    render(<Host />);
    down();
    hold();
    const blur = document.querySelector<HTMLElement>("[data-hold-slider-blur]")!;
    const scrim = document.querySelector<HTMLElement>("[data-hold-slider-scrim]")!;
    const px = (v: string) => Number.parseFloat(v);
    const halfHeight = px(blur.style.height) / 2;
    expect(px(scrim.style.getPropertyValue("--dial-ry"))).toBeCloseTo(halfHeight, 5);
    // Horizontally the spread survives — there is no chrome to overrun there.
    expect(px(scrim.style.getPropertyValue("--dial-rx"))).toBeGreaterThan(
      px(blur.style.width) / 2,
    );
    up();
    restore();
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
    const core = () => thumb().querySelector<HTMLElement>("[data-tone]")!;
    moveTo(DOWN_X + 2 * DETENT_SPACING_PX);
    expect(thumb().style.left).toBe(dots()[2]!.style.left);
    // The core takes the tone's own ramp color, so it and the fill can never
    // disagree about what the level is (ADR-0014: one TONE_COLOR map).
    expect(core().dataset.tone).toBe("laser");
    expect(core().style.backgroundColor).toContain("--laser");
    moveTo(DOWN_X + 4 * DETENT_SPACING_PX);
    expect(core().dataset.tone).toBe("ultra");
    expect(core().style.backgroundColor).toContain("--ultra-ink");
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

describe("the latched phase (latchOnTap)", () => {
  /** Absolute x of a detent center inside the mounted overlay. Latched
   *  mapping is absolute — the finger is on the track, not offset from a
   *  pill it pressed — so the tests aim at real centers. */
  const centerX = (i: number) => {
    const track = overlay()!;
    const left = Number(String(track.style.left).replace("px", ""));
    const dot = track.querySelector<HTMLElement>(
      `[data-detent-dot="${DETENTS[i]!.id}"]`,
    )!;
    return left + Number(dot.style.left.replace("px", ""));
  };
  const tapOpen = () => {
    down();
    up();
  };

  it("opts OUT by default — a tap still falls through to the pill's click", () => {
    // The split is per-instance. Every consumer today opts IN (there is no
    // sheet left behind either dial), but the fall-through path is what an
    // instance in front of a real dropdown would use, and it must not rot.
    const onOpen = vi.fn();
    render(<Host onOpen={onOpen} />);
    tapOpen();
    fireEvent.click(pill());
    expect(overlay()).toBeNull();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("opens on a tap, stays up, and swallows the pill's own click", () => {
    const onOpen = vi.fn();
    render(<Host latchOnTap onOpen={onOpen} />);
    tapOpen();
    fireEvent.click(pill());
    expect(overlay()).not.toBeNull();
    expect(overlay()!.dataset.holdSliderPhase).toBe("latched");
    // The tap that opened the capsule must not ALSO fire whatever the
    // trigger does on click — one gesture, one outcome.
    expect(onOpen).not.toHaveBeenCalled();
    // No pointer is down; the capsule outlives it indefinitely.
    act(() => vi.advanceTimersByTime(5000));
    expect(overlay()).not.toBeNull();
  });

  it("takes pointer events itself, unlike the pointer-inert drag phase", () => {
    const { unmount } = render(<Host latchOnTap />);
    down();
    hold();
    expect(overlay()!.className).toContain("pointer-events-none");
    up();
    unmount();

    render(<Host latchOnTap />);
    tapOpen();
    expect(overlay()!.className).toContain("pointer-events-auto");
    // `pinch-zoom` while latched, NEVER `none`: the scrub needs the UA to
    // stop reading a single finger as a pan, and nothing more. `none` would
    // also deny ZOOM, and touch-action resolves at gesture start on the
    // element the touch began on — earlier than the window handler's
    // multi-touch exemption, which therefore could not save it (Codex
    // review, PR #109).
    expect(overlay()!.style.touchAction).toBe("pinch-zoom");
  });

  it("scrubs on the track and commits the stop under the release", () => {
    const onCommit = vi.fn();
    render(<Host latchOnTap onCommit={onCommit} />);
    tapOpen();
    const track = overlay()!;
    fireEvent.pointerDown(track, { pointerId: 2, clientX: centerX(2), clientY: 400 });
    expect(overlay()!.textContent).toContain("Medium");
    fireEvent.pointerMove(track, { pointerId: 2, clientX: centerX(4), clientY: 400 });
    expect(overlay()!.textContent).toContain("Extra High");
    fireEvent.pointerUp(track, { pointerId: 2, clientX: centerX(4), clientY: 400 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(4);
    expect(overlay()).toBeNull();
  });

  it("reverts on a cancelled scrub — the OS taking the stream is not a commit", () => {
    // pointercancel is the OS taking the pointer away mid-scrub: a system
    // gesture, a call arriving, the UA reclassifying the drag as a pan. The
    // user released nothing. The first cut routed cancel to the commit
    // handler, which would have saved whichever detent the finger happened
    // to be over at the interruption (Codex review, PR #109) — and every
    // other cancellation path in this system reverts.
    const onCommit = vi.fn();
    render(<Host latchOnTap onCommit={onCommit} />);
    tapOpen();
    const track = overlay()!;
    fireEvent.pointerDown(track, { pointerId: 2, clientX: centerX(3), clientY: 400 });
    expect(overlay()!.textContent).toContain("High");
    fireEvent.pointerCancel(track, { pointerId: 2, clientX: centerX(3), clientY: 400 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(overlay()).toBeNull();
    // …and the claim came down with it, so the control still works.
    tapOpen();
    expect(overlay()).not.toBeNull();
  });

  it("ignores a stray second pointer's up or cancel on the track", () => {
    // The scrub is identity-checked the way useHoldDrag checks its own press
    // record: a second device's events must not end — much less commit — a
    // scrub they never started.
    const onCommit = vi.fn();
    render(<Host latchOnTap onCommit={onCommit} />);
    tapOpen();
    const track = overlay()!;
    fireEvent.pointerDown(track, { pointerId: 2, clientX: centerX(2), clientY: 400 });
    fireEvent.pointerUp(track, { pointerId: 7, clientX: centerX(5), clientY: 400 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(overlay()).not.toBeNull();
    fireEvent.pointerCancel(track, { pointerId: 7, clientX: centerX(5), clientY: 400 });
    expect(overlay()).not.toBeNull();
    // The owning pointer still finishes its own scrub normally.
    fireEvent.pointerUp(track, { pointerId: 2, clientX: centerX(2), clientY: 400 });
    expect(onCommit).toHaveBeenCalledWith(2);
  });

  it("holds the app-wide claim for the capsule's whole life", () => {
    // The claim is what makes one capsule exclusive. The drag phase releases
    // it at pointer-up; the latched phase must INHERIT it instead, or a
    // second pill could open a rival capsule beside the live one.
    const other = vi.fn();
    render(
      <>
        <Host latchOnTap />
        <div data-other="">
          <HoldSliderTrigger
            detents={DETENTS}
            selectedIndex={0}
            liveLabel={liveLabel}
            onCommit={other}
            enabled
          >
            <button type="button">Other</button>
          </HoldSliderTrigger>
        </div>
      </>,
    );
    tapOpen();
    const otherPill = screen.getByRole("button", { name: "Other" });
    fireEvent.pointerDown(otherPill, {
      pointerId: 9,
      clientX: 700,
      clientY: 400,
      button: 0,
    });
    hold();
    expect(document.querySelectorAll("[data-hold-slider-overlay]")).toHaveLength(1);
    fireEvent.pointerUp(otherPill, { pointerId: 9, clientX: 700, clientY: 400 });
    expect(other).not.toHaveBeenCalled();

    // Dismiss, and the other pill works again — the claim really was
    // released, not leaked.
    fireEvent.pointerDown(document.querySelector("[data-hold-slider-scrim]")!, {
      pointerId: 10,
      clientX: 5,
      clientY: 5,
    });
    expect(overlay()).toBeNull();
    fireEvent.pointerDown(otherPill, {
      pointerId: 11,
      clientX: 700,
      clientY: 400,
      button: 0,
    });
    hold();
    expect(overlay()).not.toBeNull();
    fireEvent.pointerUp(otherPill, { pointerId: 11, clientX: 700, clientY: 400 });
    expect(other).toHaveBeenCalledWith(0);
  });

  it("keeps pinch-zoom alive while latched, and still blocks one-finger pans", () => {
    // The drag phase blocks every touchmove for exactly as long as the press
    // lasts, which is right. The latched capsule outlives its finger and can
    // stay up indefinitely, so the same blanket block quietly disabled
    // PINCH-ZOOM for its whole life (Codex review, PR #109) — in an app that
    // preserves native zoom on purpose: the resting claim is `pinch-zoom`,
    // ADR-0012 refused the app-wide `none`, and the geometry reads the visual
    // viewport for no other reason. Two fingers are a zoom, not a scroll.
    const touchMove = (touches: number) =>
      fireEvent(
        window,
        Object.assign(
          new Event("touchmove", { bubbles: true, cancelable: true }),
          { touches: Array.from({ length: touches }, () => ({})) },
        ),
      );

    render(<Host latchOnTap />);
    tapOpen();
    expect(overlay()).not.toBeNull();
    // Two fingers pass through — the UA gets to zoom.
    expect(touchMove(2)).toBe(true);
    // One finger is still refused: the world stays frozen under the capsule.
    expect(touchMove(1)).toBe(false);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(touchMove(1)).toBe(true);
  });

  it("blocks multi-touch in the DRAG phase, where the press is still down", () => {
    // Unchanged from ADR-0012: mid-drag the block is what stops a late pan
    // stealing the captured pointer, and it ends with the press. Only the
    // latched phase's inverted lifetime earned the exemption above.
    const touchMove = (touches: number) =>
      fireEvent(
        window,
        Object.assign(
          new Event("touchmove", { bubbles: true, cancelable: true }),
          { touches: Array.from({ length: touches }, () => ({})) },
        ),
      );
    render(<Host />);
    down();
    hold();
    expect(touchMove(2)).toBe(false);
    expect(touchMove(1)).toBe(false);
    up();
    expect(touchMove(2)).toBe(true);
  });

  it("closes on concealment without committing — no capsule in a hidden tab", () => {
    // The one ending no pointer or key event can report. A drag leaves a
    // press record for the net to find; a latched capsule leaves none, so
    // the watch has to key off the OPEN STATE instead — otherwise the world
    // stays frozen behind a capsule in a backgrounded tab.
    const onCommit = vi.fn();
    render(<Host latchOnTap onCommit={onCommit} />);
    tapOpen();
    fireEvent.keyDown(window, { key: "End" });
    expect(overlay()!.textContent).toContain("Max");
    fireEvent.blur(window);
    expect(overlay()).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
    expect(document.documentElement.hasAttribute("data-hold-gesture")).toBe(false);
  });

  it("announces every keyboard step, so the ladder is aimable by ear", () => {
    // The drag phase is deliberately silent (a finger sweeping six detents
    // would be a stream of noise ending in the commit that announces
    // itself); keyboard stepping is the opposite — each step IS the
    // feedback, and this is the path that replaced the retired sheet.
    render(<Host latchOnTap />);
    const region = () =>
      document.querySelector<HTMLElement>("[data-hold-slider-announce]")!;
    tapOpen();
    expect(region().textContent).toBe("Fable 5 · Auto");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(region().textContent).toBe("Fable 5 · Low");
    fireEvent.keyDown(window, { key: "End" });
    expect(region().textContent).toBe("Fable 5 · Max");
  });

  it("paints the top stop as an event, and only the top stop", () => {
    render(<Host latchOnTap peakCaption="Costs the most" />);
    tapOpen();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(overlay()!.querySelector("[data-hold-slider-burst]")).toBeNull();
    expect(overlay()!.querySelector("[data-hold-slider-surge]")).toBeNull();
    expect(overlay()!.querySelector("[data-hold-slider-caption]")).toBeNull();
    fireEvent.keyDown(window, { key: "End" });
    expect(overlay()!.querySelector("[data-hold-slider-burst]")).not.toBeNull();
    expect(overlay()!.querySelector("[data-hold-slider-surge]")).not.toBeNull();
    expect(overlay()!.querySelector("[data-hold-slider-caption]")!.textContent).toBe(
      "Costs the most",
    );
    // Leaving the top takes all three with it — none of them is a state the
    // capsule can get stuck in.
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(overlay()!.querySelector("[data-hold-slider-burst]")).toBeNull();
    expect(overlay()!.querySelector("[data-hold-slider-caption]")).toBeNull();
  });

  it("lays the ramp across the TRACK, pinned to the detents' own tones", () => {
    // Two properties at once (HoldSlider's rampGradient note): the ramp is
    // sized to the track so a growing fill reveals it rather than
    // restretching it, and its stops come from the DETENTS so a level's
    // colour cannot drift with the ladder's length.
    render(<Host latchOnTap />);
    tapOpen();
    const ramp = overlay()!.querySelector<HTMLElement>("[data-hold-slider-ramp]")!;
    const image = ramp.style.backgroundImage;
    // Two stops per detent — the tone's own position and the end of its HOLD
    // — except the last, which has no gap to hold across. The two-decimal
    // form is the STOP POSITION's: the muted tones are color-mix()es carrying
    // whole-percent weights of their own, so the pattern has to tell the two
    // kinds of percentage apart.
    const positions = (image.match(/\d+\.\d\d%/g) ?? []).map((p) => parseFloat(p));
    expect(positions).toHaveLength(DETENTS.length * 2 - 1);
    // Monotonic, and every hold lands short of the next detent — a hold that
    // overshot would put a detent inside its neighbour's blend, which is the
    // colour-coding failing quietly.
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]!).toBeGreaterThan(positions[i - 1]!);
    }
    for (let i = 0; i < DETENTS.length - 1; i++) {
      expect(positions[i * 2 + 1]!).toBeLessThan(positions[i * 2 + 2]!);
    }
    expect(image.indexOf("--silver")).toBeLessThan(image.indexOf("--laser"));
    expect(image.indexOf("--laser")).toBeLessThan(image.indexOf("--ultra-ink"));
    // Sized to the track, not to the fill it is seen through.
    const trackWidth = Number(String(overlay()!.style.width).replace("px", ""));
    const rampWidth = Number(String(ramp.style.width).replace("px", ""));
    expect(rampWidth).toBeGreaterThan(trackWidth * 0.7);
    const before = ramp.style.backgroundImage;
    fireEvent.keyDown(window, { key: "End" });
    // …so moving the value does not repaint it.
    expect(
      overlay()!.querySelector<HTMLElement>("[data-hold-slider-ramp]")!.style
        .backgroundImage,
    ).toBe(before);
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
    // The refused stream's own click is pointer-derived (detail ≥ 1).
    fireEvent.click(pillB(), { detail: 1 });
    expect(onOpenB).not.toHaveBeenCalled();
    // The refusal ended with its stream: a fresh tap on B works.
    downOn(pillB(), 2);
    fireEvent.pointerUp(pillB(), { pointerId: 2, clientX: DOWN_X, clientY: 400 });
    fireEvent.click(pillB());
    expect(onOpenB).toHaveBeenCalledTimes(1);
  });

  it("keeps a SAME-pill competing press refused even when the owner releases first", () => {
    // The thirteenth pass carried a refusal past the owner's release for a
    // FOREIGN pill and deliberately exempted the owner's own wrapper: the
    // mid-claim window was covered by any-claim consumption, but the
    // outlive-the-owner timeline was never re-run on this topology. Touch
    // owns A, a mouse presses A mid-gesture (bare-rejected, no marker),
    // A commits and releases — and the mouse's later lift-click passed
    // every gate and popped the sheet right on the heels of the drag
    // (nineteenth pass). Same mechanism as cross-pill now: marker +
    // end-watch, on the owning wrapper too.
    const onOpenA = vi.fn();
    const onCommitA = vi.fn();
    render(<TwinHosts onOpenA={onOpenA} onCommitA={onCommitA} />);
    downOn(pillA(), 1); // touch owns A
    hold();
    expect(overlays()).toHaveLength(1);
    downOn(pillA(), 2); // a mouse presses the SAME pill — refused, marked
    expect(overlays()).toHaveLength(1); // the live gesture is untouched
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
    act(() => {
      vi.advanceTimersByTime(1); // the owner's settle suppression expires
    });
    // The competing mouse lifts over the pill — pointer-derived click.
    fireEvent.pointerUp(pillA(), { pointerId: 2, clientX: DOWN_X, clientY: 400 });
    fireEvent.click(pillA(), { detail: 1 });
    expect(onOpenA).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1); // the end-watch clears the marker
    });
    // A fresh tap still opens — the refusal died with its stream.
    downOn(pillA(), 3);
    fireEvent.pointerUp(pillA(), { pointerId: 3, clientX: DOWN_X, clientY: 400 });
    fireEvent.click(pillA(), { detail: 1 });
    expect(onOpenA).toHaveBeenCalledTimes(1);
  });

  it("the owner's own settled click cannot strip the competitor's refusal", () => {
    // The consume body used to clear the marker no matter which gate fired.
    // Cross-pill that was harmless — the owner's clicks never route through
    // the refused wrapper — but same-pill the owner's commit click and the
    // competitor's lift-click cross the SAME capture handler, and a
    // settle-consumed commit click would strip the competitor's marker
    // before its own click arrived (nineteenth pass). The marker's
    // lifecycle belongs to its end-watch, the next pointer-down's
    // supersede, and unmount — consumption reads it, never writes it.
    const onOpenA = vi.fn();
    render(<TwinHosts onOpenA={onOpenA} />);
    downOn(pillA(), 1);
    hold();
    downOn(pillA(), 2); // refused, marked
    fireEvent.pointerUp(pillA(), { pointerId: 1, clientX: DOWN_X, clientY: 400 });
    fireEvent.click(pillA(), { detail: 1 }); // the owner's settle-window click
    expect(onOpenA).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1); // suppression expires; the marker must survive
    });
    fireEvent.pointerUp(pillA(), { pointerId: 2, clientX: DOWN_X, clientY: 400 });
    fireEvent.click(pillA(), { detail: 1 }); // the competitor's lift-click
    expect(onOpenA).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    downOn(pillA(), 3);
    fireEvent.pointerUp(pillA(), { pointerId: 3, clientX: DOWN_X, clientY: 400 });
    fireEvent.click(pillA(), { detail: 1 });
    expect(onOpenA).toHaveBeenCalledTimes(1);
  });

  it("a pending same-pill refusal never blocks keyboard activation", () => {
    // The marker gates only pointer-derived clicks (detail ≥ 1). With the
    // gesture over but the competing mouse still physically down somewhere,
    // keyboard activation carries detail 0 and must land — the
    // discriminator, not timing, keeps every marker source away from
    // keyboard users (seventeenth pass, now including the same-pill one).
    const onOpenA = vi.fn();
    render(<TwinHosts onOpenA={onOpenA} />);
    downOn(pillA(), 1);
    hold();
    downOn(pillA(), 2); // refused, marked
    fireEvent.pointerUp(pillA(), { pointerId: 1, clientX: DOWN_X, clientY: 400 });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    fireEvent.click(pillA()); // keyboard/programmatic: detail 0
    expect(onOpenA).toHaveBeenCalledTimes(1);
  });

  it("retains every refused pointer until its own end — a sibling never un-protects the elder", () => {
    // Twenty-second pass, re-pricing the nineteenth's "newest wins" slot:
    // touch owns A; a mouse AND a second touch press B while the claim is
    // live. The single slot let the later refusal REPLACE the earlier —
    // the newer stream's end cleared the whole marker, and the elder
    // mouse's later click opened B's sheet right after the owning drag.
    // Refusals now accumulate per-stream and each ends with its own.
    const onOpenB = vi.fn();
    render(<TwinHosts onOpenB={onOpenB} />);
    downOn(pillA(), 1);
    hold();
    downOn(pillB(), 2); // refused — the elder
    downOn(pillB(), 3); // refused — the sibling that used to steal the slot
    // The sibling ends first, far away; its removal must not clear the elder.
    fireEvent.pointerUp(document.body, { pointerId: 3, clientX: 500, clientY: 600 });
    act(() => {
      vi.advanceTimersByTime(1); // the sibling's zero-timeout removal
    });
    fireEvent.pointerUp(pillA(), { pointerId: 1, clientX: DOWN_X, clientY: 400 });
    act(() => {
      vi.advanceTimersByTime(1); // the owner's settle suppression expires
    });
    fireEvent.pointerUp(pillB(), { pointerId: 2, clientX: DOWN_X, clientY: 400 });
    fireEvent.click(pillB(), { detail: 1 }); // the elder's own click
    expect(onOpenB).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    // Every refusal ended with its stream — a fresh tap works.
    downOn(pillB(), 4);
    fireEvent.pointerUp(pillB(), { pointerId: 4, clientX: DOWN_X, clientY: 400 });
    fireEvent.click(pillB());
    expect(onOpenB).toHaveBeenCalledTimes(1);
  });

  it("same-pill sibling refusals are each retained through their own click", () => {
    // The same accumulation on the OWNING wrapper (nineteenth pass's
    // topology): both competitors' clicks must die with their own streams,
    // in either lift order, even after the owner commits and releases.
    const onOpenA = vi.fn();
    const onCommitA = vi.fn();
    render(<TwinHosts onOpenA={onOpenA} onCommitA={onCommitA} />);
    downOn(pillA(), 1);
    hold();
    downOn(pillA(), 2); // refused — the elder
    downOn(pillA(), 3); // refused — the sibling
    fireEvent.pointerUp(pillA(), { pointerId: 1, clientX: DOWN_X, clientY: 400 });
    expect(onCommitA).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    // The later-refused lifts first over the pill…
    fireEvent.pointerUp(pillA(), { pointerId: 3, clientX: DOWN_X, clientY: 400 });
    fireEvent.click(pillA(), { detail: 1 });
    expect(onOpenA).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    // …and the elder's click STILL dies with its own stream.
    fireEvent.pointerUp(pillA(), { pointerId: 2, clientX: DOWN_X, clientY: 400 });
    fireEvent.click(pillA(), { detail: 1 });
    expect(onOpenA).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    downOn(pillA(), 4);
    fireEvent.pointerUp(pillA(), { pointerId: 4, clientX: DOWN_X, clientY: 400 });
    fireEvent.click(pillA(), { detail: 1 });
    expect(onOpenA).toHaveBeenCalledTimes(1);
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
    // minutes later (pointer-derived, detail ≥ 1), and it must die with
    // ITS stream, not open the sheet after a revert (fifteenth pass).
    fireEvent.pointerUp(pillA(), { pointerId: 1, clientX: DOWN_X, clientY: 400 });
    fireEvent.click(pillA(), { detail: 1 });
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

  it("a marker stranded by an outside death can never eat a keyboard click", () => {
    // The concealed stream's end-watch waits for a pointerup that a
    // release in another application never sends — so the marker CAN sit
    // stranded, and every timing-based expiry had a hole (sixteenth and
    // seventeenth passes). The discriminator is the click itself: keyboard
    // and programmatic activation carry detail 0 and always pass the
    // marker, stranded or not.
    const onOpenA = vi.fn();
    render(<TwinHosts onOpenA={onOpenA} />);
    downOn(pillA(), 1);
    hold();
    fireEvent.blur(window); // conceal: revert + marker + watch
    expect(overlays()).toHaveLength(0);
    // The pointer releases in the other app — no event ever arrives, the
    // marker is stranded. The keyboard activation (detail 0) lands anyway.
    fireEvent.click(pillA());
    expect(onOpenA).toHaveBeenCalledTimes(1);
  });

  it("returning STILL HOLDING and lifting over the pill cannot open its sheet", () => {
    // The seventeenth pass's scenario, which broke the foreground-expiry
    // repair: alt-tab away holding the button, come back (focus fires),
    // and only then lift over the pill. The lift's click is
    // pointer-derived (detail ≥ 1) — the marker consumes it regardless of
    // when focus fired, because the discriminator carries no timing.
    const onOpenA = vi.fn();
    render(<TwinHosts onOpenA={onOpenA} />);
    downOn(pillA(), 1);
    hold();
    fireEvent.blur(window); // conceal: revert + marker + watch
    fireEvent.focus(window); // the user returns, button still down
    fireEvent.pointerUp(pillA(), { pointerId: 1, clientX: DOWN_X, clientY: 400 });
    fireEvent.click(pillA(), { detail: 1 }); // the abandoned stream's lift-click
    expect(onOpenA).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    // A fresh pointer tap works — the marker died with its stream.
    downOn(pillA(), 1);
    fireEvent.pointerUp(pillA(), { pointerId: 1, clientX: DOWN_X, clientY: 400 });
    fireEvent.click(pillA(), { detail: 1 });
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

describe("the resting mini-track", () => {
  /**
   * The affordance that replaced three grip ticks (owner's second pass,
   * 2026-08-11: "I want the button to be obvious with indications to press or
   * an animation to press and hold to drag and slide it or a permanently
   * visible slider"). It is the third of those at pill scale — the control
   * showing the slider it becomes, at the value it holds.
   *
   * Two of the assertions below are the anti-TOGGLE properties. Both were
   * found by looking at a capture rather than by a test, which is exactly why
   * they need one: the first cut put a knob of the rail's own height flush
   * against the rail's end, and at the bottom of the Thinking ladder — "Auto",
   * where every new device starts — that is a switch in the off position.
   */
  const parts = () => {
    const root = document.querySelector<HTMLElement>("[data-hold-hint]")!;
    return {
      root,
      rootW: Number.parseFloat(root.style.width),
      fill: document.querySelector<HTMLElement>("[data-hold-hint-fill]")!,
      thumb: document.querySelector<HTMLElement>("[data-hold-hint-thumb]")!,
    };
  };

  it("fills to the committed value in that value's own tone", () => {
    const { rerender } = render(<HoldSliderHint value={0} max={5} tone="faint" />);
    const bottom = Number.parseFloat(parts().thumb.style.left);
    const bottomFill = Number.parseFloat(parts().fill.style.width);

    rerender(<HoldSliderHint value={5} max={5} tone="ultra" />);
    const top = Number.parseFloat(parts().thumb.style.left);
    expect(top).toBeGreaterThan(bottom);
    expect(Number.parseFloat(parts().fill.style.width)).toBeGreaterThan(bottomFill);
    // The same TONE_COLOR map the capsule's ramp is built from, so the pill
    // and the track it opens can never disagree about a level's colour.
    expect(parts().fill.style.backgroundColor).toContain("--ultra-ink");

    rerender(<HoldSliderHint value={2} max={5} tone="laser" />);
    const mid = Number.parseFloat(parts().thumb.style.left);
    expect(mid).toBeGreaterThan(bottom);
    expect(mid).toBeLessThan(top);
  });

  it("keeps the thumb taller than its rail — a slider, not a switch", () => {
    render(<HoldSliderHint value={2} max={5} tone="laser" />);
    const { fill, thumb } = parts();
    expect(Number.parseFloat(thumb.style.height)).toBeGreaterThan(
      Number.parseFloat(fill.style.height),
    );
  });

  it("never parks the thumb flush against either end — a switch always does", () => {
    const { rerender } = render(<HoldSliderHint value={0} max={5} tone="faint" />);
    const width = parts().rootW;
    const half = Number.parseFloat(parts().thumb.style.width) / 2;
    // Centre-anchored, so "flush left" is left === half.
    expect(Number.parseFloat(parts().thumb.style.left)).toBeGreaterThan(half);
    rerender(<HoldSliderHint value={5} max={5} tone="ultra" />);
    expect(Number.parseFloat(parts().thumb.style.left)).toBeLessThan(width - half);
  });

  it("pulses only until the user has driven a dial once", () => {
    // The owner's "animation to press and hold to drag and slide it". The
    // hosts gate it on the same dialTipSeen flag as the coach line, so the
    // moving hint and the written one retire together on the first commit.
    const { rerender } = render(<HoldSliderHint value={0} max={5} tone="faint" pulse />);
    expect(parts().thumb.className).toContain("hold-hint-pulse");
    rerender(<HoldSliderHint value={0} max={5} tone="faint" />);
    expect(parts().thumb.className).not.toContain("hold-hint-pulse");
  });

  it("stays decoration — the pill's label and role are the readout", () => {
    render(<HoldSliderHint value={3} max={5} tone="laser" />);
    expect(parts().root.getAttribute("aria-hidden")).toBe("true");
    expect(parts().root.textContent).toBe("");
  });
});

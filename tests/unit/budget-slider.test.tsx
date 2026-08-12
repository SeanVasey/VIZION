import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { useUIStore } from "@/stores/ui";
import { DETENT_SPACING_PX, HOLD_MS, SLOP_PX } from "@/components/ui/use-hold-drag";

/**
 * Auto's routing dial — Budget → Balanced → Quality (ADR-0012, relocated and
 * redesigned in ADR-0014).
 *
 * WHERE IT LIVES is now half the contract. Until 2026-08-11 this was a hold
 * gesture layered on the composer's Target pill, gated on Auto already being
 * on so a hold could not silently flip modes. Owner direction moved it inside
 * the Target sheet, directly under the Auto card it tunes — "within the model
 * selection pane that slides out from the right" — which dissolves the gating
 * question (the dial is visible only where Auto is being chosen, and using it
 * is as explicit an act as tapping the Auto row) and replaces it with a
 * harder one: the capsule must open INSIDE an open dialog, which every other
 * slider in the app is forbidden to do.
 *
 * ORDER is the other half, unchanged: the wire constant AUTO_PREFERENCES is
 * quality-first and test-pinned (models.test / the server contract), while
 * the dial displays cheapest-first so the fill grows with spend. The display
 * order is derived by reversal, and dragging the displayed track must commit
 * the PREFERENCE UNDER THE FINGER, not its mirror image.
 */
const mockMutation = {
  isPending: false,
  isError: false as boolean,
  error: null as unknown,
  stream: {
    active: false,
    step: "waiting",
    partialOutput: "",
    tokenIn: 0,
    tokenOut: 0,
    costUsd: 0,
  },
  mutate: vi.fn(),
  reset: vi.fn(),
};
vi.mock("@/lib/enhance/use-enhance", () => ({ useEnhance: () => mockMutation }));
vi.mock("@/components/media/AttachmentTray", () => ({ AttachmentTray: () => null }));
vi.mock("@/components/diff/TransformationDiff", () => ({
  TransformationDiff: () => null,
}));
// Mounted whenever a test puts the mutation in flight; its scroll-into-view
// effect wants matchMedia, which this jsdom setup doesn't provide — and these
// tests assert on the capsule, never on the streaming surface itself.
vi.mock("@/components/diff/StreamingResult", () => ({
  StreamingResult: () => null,
}));

import { EnhanceComposer } from "@/components/editor/EnhanceComposer";

function renderComposer() {
  return render(
    <ToastProvider>
      <EnhanceComposer />
    </ToastProvider>,
  );
}

const targetTrigger = () => screen.getByRole("button", { name: /^Target model:/ });
const tuningDial = () =>
  screen.getByRole("slider", { name: "Auto routing preference" });
const overlay = () => document.querySelector<HTMLElement>("[data-hold-slider-overlay]");

const openSheet = () => {
  fireEvent.click(targetTrigger());
  return screen.getByRole("dialog", { name: "Target model" });
};

const DOWN_X = 300;
function holdAndDrag(steps: number) {
  const dial = tuningDial();
  fireEvent.pointerDown(dial, {
    pointerId: 1,
    clientX: DOWN_X,
    clientY: 400,
    button: 0,
  });
  act(() => {
    vi.advanceTimersByTime(HOLD_MS);
  });
  const x = DOWN_X + steps * DETENT_SPACING_PX;
  fireEvent.pointerMove(dial, { pointerId: 1, clientX: x, clientY: 400 });
  fireEvent.pointerUp(dial, { pointerId: 1, clientX: x, clientY: 400 });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // Reset here, not at the end of the test that sets it: a failing assertion
  // would otherwise leave the mutation in flight and take the rest of the
  // file down with it.
  mockMutation.isPending = false;
  mockMutation.stream.active = false;
  useUIStore.setState({
    editorDraft: "",
    activeMode: "polish",
    autoTarget: true,
    autoPreference: "balanced",
    targetModel: "opus_5",
    thinkingLevels: {},
    dialTipSeen: true,
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("where the tuning dial lives", () => {
  it("sits inside the model sheet, not on the composer rail", () => {
    renderComposer();
    // The rail pill is a plain dropdown trigger again: no dial, no grip.
    expect(screen.queryByRole("slider", { name: "Auto routing preference" })).toBeNull();
    expect(targetTrigger().querySelector("[data-hold-hint]")).toBeNull();

    const dialog = openSheet();
    expect(dialog.contains(tuningDial())).toBe(true);
    expect(tuningDial().querySelector("[data-hold-hint]")).not.toBeNull();
  });

  it("wears the same resting mini-track as the Thinking dial", () => {
    // One control class, one affordance. The owner asked for the redesign to
    // reach both dials ("the same thing should apply to the slider for the
    // dropdown into model auto selecting"), and it does so by construction —
    // the hint is the shared primitive's, not either host's.
    renderComposer();
    openSheet();
    const thumbX = () =>
      Number.parseFloat(
        tuningDial().querySelector<HTMLElement>("[data-hold-hint-thumb]")!.style.left,
      );
    const fill = () =>
      tuningDial().querySelector<HTMLElement>("[data-hold-hint-fill]")!.style
        .backgroundColor;
    expect(tuningDial().getAttribute("aria-valuenow")).toBe("1");
    const balanced = thumbX();
    holdAndDrag(1);
    expect(tuningDial().getAttribute("aria-valuenow")).toBe("2");
    expect(thumbX()).toBeGreaterThan(balanced);
    // Quality is the ultra tier, so the mini fill states the tier the same
    // way the capsule's ramp does at that stop.
    expect(fill()).toContain("--ultra-ink");
  });

  it("still names the live preference on the rail pill at rest", () => {
    // The dial is behind a sheet, so the pill is the only place the choice
    // is visible without opening anything. It must keep saying it.
    renderComposer();
    expect(targetTrigger()).toHaveTextContent("Auto · Balanced");
    openSheet();
    holdAndDrag(1);
    expect(targetTrigger()).toHaveTextContent("Auto · Quality");
  });

  it("leaves the sheet's vertical pan native — no scroll trap over the dial", () => {
    // The dial spans the full width of an `overflow-y-auto` pane holding
    // sixteen model rows, so a touch that starts on it must still scroll the
    // list. `touch-action` is consulted ONCE at gesture start, so the hook's
    // y-dominant stand-down cannot hand the pan back afterwards — the
    // resting claim is the only thing that can, and the default claim denies
    // every single-finger pan (Codex review, PR #109). Horizontal stays
    // refused: that axis is the slider's.
    renderComposer();
    openSheet();
    const wrapper = tuningDial().parentElement!;
    expect(wrapper.style.touchAction).toBe("pan-y pinch-zoom");
  });

  it("keeps the composer rail's pill on the exclusive claim", () => {
    // The exemption is per-instance and deliberately narrow: a content-width
    // pill in a rail is not a scroll surface, and ADR-0012 measured what
    // handing it `pan-y` costs (a pre-hold drift cancels the press — "the
    // slider never appears"). Only the full-width sheet dial opts out.
    useUIStore.setState({ dialTipSeen: true });
    renderComposer();
    const thinking = screen.getByRole("slider", { name: "Thinking depth" });
    expect(thinking.parentElement!.style.touchAction).toBe("pinch-zoom");
  });

  it("declares the ARIA slider contract, cheapest-first", () => {
    renderComposer();
    openSheet();
    const dial = tuningDial();
    expect(dial.getAttribute("aria-valuemin")).toBe("0");
    expect(dial.getAttribute("aria-valuemax")).toBe("2");
    expect(dial.getAttribute("aria-valuenow")).toBe("1"); // balanced, the middle
    expect(dial.getAttribute("aria-valuetext")).toBe("Balanced");
  });

  it("offers the three presets cheapest-first as equal dots", () => {
    renderComposer();
    openSheet();
    fireEvent.pointerDown(tuningDial(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    const dots = overlay()!.querySelectorAll("[data-detent-dot]");
    expect([...dots].map((d) => d.getAttribute("data-detent-dot"))).toEqual([
      "budget",
      "balanced",
      "quality",
    ]);
    // Dots, never the Thinking ladder's rising bars — form is what tells the
    // two capsules apart, since the tokens are locked and the ramp is the
    // level's own.
    expect(overlay()!.querySelector("[data-detent-bar]")).toBeNull();
    fireEvent.pointerCancel(tuningDial(), { pointerId: 1 });
  });
});

describe("the capsule opens inside its own sheet", () => {
  it("engages under a hold even though a dialog is open", () => {
    // The activation guard stands a gesture down over any open role=dialog —
    // except one that CONTAINS the trigger. That exception is what makes
    // this control possible at all, and it is scoped by containment, so a
    // foreign sheet still stands the gesture down (thinking-rail covers the
    // other side).
    renderComposer();
    openSheet();
    fireEvent.pointerDown(tuningDial(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    expect(overlay()).not.toBeNull();
    fireEvent.pointerCancel(tuningDial(), { pointerId: 1 });
  });

  it("ships the capsule dim-only while a run is in flight", () => {
    // The rails stay live mid-run by design (dialling the NEXT run), so the
    // sheet can be opened over a streaming composer — and the capsule's
    // full-viewport backdrop-filter would then re-filter on every streamed
    // repaint, the trap ADR-0012's eighth pass identified. The composer's own
    // wrapper carried this state until the dial moved into the sheet, where
    // the move simply dropped it (Codex review, PR #109).
    mockMutation.isPending = true;
    renderComposer();
    openSheet();
    fireEvent.pointerDown(tuningDial(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    expect(overlay()).not.toBeNull();
    expect(document.querySelector("[data-hold-slider-blur]")).toBeNull();
    // The dim always mounts — it is the input shield as well as the drop-back.
    expect(document.querySelector("[data-hold-slider-scrim]")).not.toBeNull();
    fireEvent.pointerCancel(tuningDial(), { pointerId: 1 });
  });

  it("blurs normally at rest — the stand-down is for a live stream only", () => {
    renderComposer();
    openSheet();
    fireEvent.pointerDown(tuningDial(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    expect(document.querySelector("[data-hold-slider-blur]")).not.toBeNull();
    fireEvent.pointerCancel(tuningDial(), { pointerId: 1 });
  });

  it("keeps the sheet open when the dial commits", () => {
    // A segment tap was a discrete choice that ended the interaction, so it
    // closed the sheet. A dial is something you adjust and look at — closing
    // the pane out from under a drag threw away the result just dialled in.
    renderComposer();
    openSheet();
    holdAndDrag(1);
    expect(screen.getByRole("dialog", { name: "Target model" })).toBeInTheDocument();
    expect(useUIStore.getState().autoPreference).toBe("quality");
  });

  it("one Escape dismisses the capsule, not the sheet under it", () => {
    renderComposer();
    openSheet();
    fireEvent.pointerDown(tuningDial(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    fireEvent.pointerUp(tuningDial(), { pointerId: 1, clientX: DOWN_X, clientY: 400 });
    expect(overlay()).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(overlay()).toBeNull();
    // The sheet is the surface BEHIND the capsule; one Escape closes one
    // surface, the one in front.
    expect(screen.getByRole("dialog", { name: "Target model" })).toBeInTheDocument();
    expect(useUIStore.getState().autoPreference).toBe("balanced");
  });
});

describe("tuning dial commits", () => {
  it("drags right to Quality and commits the preference under the finger", () => {
    renderComposer();
    openSheet();
    // balanced (index 1) anchors under the finger; one step right = quality.
    holdAndDrag(1);
    const s = useUIStore.getState();
    expect(s.autoPreference).toBe("quality");
    // The dial tunes HOW Auto routes — and turning it is choosing Auto, the
    // shortcut the Segmented was. It never picks a MODEL.
    expect(s.autoTarget).toBe(true);
    expect(s.targetModel).toBe("opus_5");
  });

  it("drags left to Budget — the un-reversed mapping would land Quality", () => {
    renderComposer();
    openSheet();
    holdAndDrag(-1);
    expect(useUIStore.getState().autoPreference).toBe("budget");
  });

  it("turns Auto ON when it commits from a plain-model state", () => {
    useUIStore.setState({ autoTarget: false });
    renderComposer();
    openSheet();
    holdAndDrag(1);
    const s = useUIStore.getState();
    expect(s.autoTarget).toBe(true);
    expect(s.autoPreference).toBe("quality");
  });

  it("retires the how-to line when it is the FIRST dial used", () => {
    // The line names the gesture, not one rail, so a user whose first dial is
    // this one has already demonstrated it — and returning to the composer to
    // be told how would be the tip lying about what it knows (Codex review,
    // PR #109). Wired through the composer, which owns the tip, so
    // TargetPicker stays entirely prop-driven for Settings' sake.
    useUIStore.setState({ dialTipSeen: false });
    renderComposer();
    expect(document.querySelector("[data-dial-coach-tip]")).not.toBeNull();
    openSheet();
    holdAndDrag(1);
    expect(useUIStore.getState().dialTipSeen).toBe(true);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Target model" }), {
      key: "Escape",
    });
    expect(document.querySelector("[data-dial-coach-tip]")).toBeNull();
  });

  it("turns Auto on even when the committed stop is the one already stored", () => {
    // The default case, and the one a de-duplication guard silently broke
    // (Codex review, PR #109): Auto off, preference already Balanced, user
    // opens the dial and commits Balanced. `onChange` here is not a plain
    // setter — it also turns Auto on — so "nothing changed, skip it" dropped
    // the half that mattered. Deliberately choosing a stop is an act whether
    // or not it moves the value.
    useUIStore.setState({ autoTarget: false, autoPreference: "balanced" });
    renderComposer();
    openSheet();
    holdAndDrag(0); // release on the anchor stop — no travel at all
    const s = useUIStore.getState();
    expect(s.autoTarget).toBe(true);
    expect(s.autoPreference).toBe("balanced");
  });

  it("does NOT flip Auto on from an arrow that cannot move", () => {
    // The one interaction that can fail to be a choice. A key that did
    // nothing visible must not flip a mode — so movement is checked before
    // the commit, rather than the commit checking for change.
    useUIStore.setState({ autoTarget: false, autoPreference: "quality" });
    renderComposer();
    openSheet();
    const dial = tuningDial();
    dial.focus();
    fireEvent.keyDown(dial, { key: "ArrowRight" }); // already at the top
    expect(useUIStore.getState().autoTarget).toBe(false);
    // …but a step that DOES move is a choice, and turns Auto on.
    fireEvent.keyDown(tuningDial(), { key: "ArrowLeft" });
    const s = useUIStore.getState();
    expect(s.autoTarget).toBe(true);
    expect(s.autoPreference).toBe("balanced");
  });

  it("steps on the arrow keys without disturbing the model radiogroup", () => {
    // The dial renders INSIDE the sheet's radiogroup, whose roving handler
    // claims the same arrows and would otherwise yank focus onto a model row
    // mid-adjust (Codex review, PR #96 — written for the Segmented, and more
    // load-bearing now that arrows ARE this control's whole keyboard
    // contract).
    renderComposer();
    openSheet();
    const dial = tuningDial();
    dial.focus();
    fireEvent.keyDown(dial, { key: "ArrowRight" });
    expect(useUIStore.getState().autoPreference).toBe("quality");
    expect(document.activeElement).toBe(tuningDial());
    fireEvent.keyDown(tuningDial(), { key: "Home" });
    expect(useUIStore.getState().autoPreference).toBe("budget");
    expect(document.activeElement).toBe(tuningDial());
  });

  it("shows only the preference under the finger while dragging", () => {
    renderComposer();
    openSheet();
    const dial = tuningDial();
    fireEvent.pointerDown(dial, {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    // The chip never repeats "Auto ·" — that context lives on the pill at
    // rest and in the commit announcement; mid-gesture the level IS the
    // message (owner de-duplication, 2026-08-10).
    expect(overlay()!.textContent).toContain("Balanced");
    expect(overlay()!.textContent).not.toContain("Auto ·");
    fireEvent.pointerMove(dial, {
      pointerId: 1,
      clientX: DOWN_X + DETENT_SPACING_PX,
      clientY: 400,
    });
    expect(overlay()!.textContent).toContain("Quality");
    // Quality tops this ramp, so it earns the cost caption — the one thing
    // the word "Quality" does not say by itself.
    expect(overlay()!.querySelector("[data-hold-slider-caption]")!.textContent).toMatch(
      /spends your cap faster/i,
    );
    fireEvent.pointerCancel(dial, { pointerId: 1 });
  });

  it("latches on a tap and picks the stop under the second tap", () => {
    renderComposer();
    openSheet();
    fireEvent.pointerDown(tuningDial(), {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
    });
    fireEvent.pointerUp(tuningDial(), { pointerId: 1, clientX: DOWN_X, clientY: 400 });
    const track = overlay()!;
    expect(track.dataset.holdSliderPhase).toBe("latched");
    const left = Number(String(track.style.left).replace("px", ""));
    const x = Number(
      track
        .querySelector<HTMLElement>('[data-detent-dot="budget"]')!
        .style.left.replace("px", ""),
    );
    fireEvent.pointerDown(track, { pointerId: 2, clientX: left + x, clientY: 400 });
    fireEvent.pointerUp(track, { pointerId: 2, clientX: left + x, clientY: 400 });
    expect(useUIStore.getState().autoPreference).toBe("budget");
    expect(overlay()).toBeNull();
  });
});

describe("the rest of the sheet is inert to the dial", () => {
  const press = (el: Element, opts: Record<string, unknown> = {}) =>
    fireEvent.pointerDown(el, {
      pointerId: 1,
      clientX: DOWN_X,
      clientY: 400,
      button: 0,
      ...opts,
    });
  const lift = (el: Element, x = DOWN_X) =>
    fireEvent.pointerUp(el, { pointerId: 1, clientX: x, clientY: 400 });
  const hold = () =>
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });

  it("a hold on the Auto card expands nothing and commits nothing", () => {
    // The admission rule: a gesture may only begin in the wrapper's own DOM
    // subtree. The Auto card is the dial's NEIGHBOUR, not its child.
    renderComposer();
    openSheet();
    const autoRow = screen.getByRole("radio", { name: /^Auto/ });
    press(autoRow);
    hold();
    expect(overlay()).toBeNull();
    lift(autoRow);
    expect(useUIStore.getState().autoPreference).toBe("balanced");
    // No suppression was armed, so the row's own tap still lands: Auto
    // stays on and the sheet closes.
    fireEvent.click(autoRow);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useUIStore.getState().autoTarget).toBe(true);
  });

  it("a press-and-slide on a model row stays a row tap", () => {
    renderComposer();
    openSheet();
    const row = screen.getByRole("radio", { name: "Fable 5" });
    press(row);
    fireEvent.pointerMove(row, {
      pointerId: 1,
      clientX: DOWN_X + SLOP_PX + 4,
      clientY: 400,
    });
    expect(overlay()).toBeNull();
    lift(row, DOWN_X + SLOP_PX + 4);
    expect(useUIStore.getState().autoPreference).toBe("balanced");
    fireEvent.click(row);
    expect(useUIStore.getState().targetModel).toBe("fable_5");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a hold on the scrim expands nothing, and its tap still closes", () => {
    renderComposer();
    const dialog = openSheet();
    // Side anchor ancestry: panel → centering column → fixed scrim.
    const scrim = dialog.parentElement!.parentElement as HTMLElement;
    press(scrim);
    hold();
    expect(overlay()).toBeNull();
    lift(scrim);
    expect(useUIStore.getState().autoPreference).toBe("balanced");
    fireEvent.click(scrim);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

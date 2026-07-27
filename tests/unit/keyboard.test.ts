import { describe, it, expect } from "vitest";
import {
  isKeyboardViewport,
  keyboardInset,
  KEYBOARD_MIN_OVERLAP,
} from "@/lib/pwa/keyboard";

// iPhone 15 Pro-ish portrait layout viewport.
const LAYOUT = 852;

describe("isKeyboardViewport — visual-viewport keyboard heuristic", () => {
  it("is false when the visual viewport matches the layout viewport", () => {
    expect(
      isKeyboardViewport({ layoutHeight: LAYOUT, visualHeight: LAYOUT, scale: 1 }),
    ).toBe(false);
  });

  it("detects a typical iOS keyboard (~300px overlap)", () => {
    expect(
      isKeyboardViewport({
        layoutHeight: LAYOUT,
        visualHeight: LAYOUT - 300,
        scale: 1,
      }),
    ).toBe(true);
  });

  it("ignores toolbar-scale height loss below the threshold", () => {
    expect(
      isKeyboardViewport({
        layoutHeight: LAYOUT,
        visualHeight: LAYOUT - KEYBOARD_MIN_OVERLAP,
        scale: 1,
      }),
    ).toBe(false);
  });

  it("fires just past the threshold", () => {
    expect(
      isKeyboardViewport({
        layoutHeight: LAYOUT,
        visualHeight: LAYOUT - KEYBOARD_MIN_OVERLAP - 1,
        scale: 1,
      }),
    ).toBe(true);
  });

  it("never treats pinch-zoom shrink as a keyboard", () => {
    // Zoomed to 2x: the visual viewport is half the layout height, no keyboard.
    expect(
      isKeyboardViewport({ layoutHeight: LAYOUT, visualHeight: LAYOUT / 2, scale: 2 }),
    ).toBe(false);
  });

  it("tolerates floating-point scale readouts at rest", () => {
    expect(
      isKeyboardViewport({
        layoutHeight: LAYOUT,
        visualHeight: LAYOUT - 320,
        scale: 1.0049,
      }),
    ).toBe(true);
  });
});

describe("keyboardInset — how far a fixed bar must lift", () => {
  it("is zero with no keyboard, so it doubles as the show/hide signal", () => {
    expect(
      keyboardInset({ layoutHeight: LAYOUT, visualHeight: LAYOUT, scale: 1 }),
    ).toBe(0);
  });

  it("returns the occluded height for an open keyboard", () => {
    expect(
      keyboardInset({
        layoutHeight: LAYOUT,
        visualHeight: LAYOUT - 300,
        scale: 1,
      }),
    ).toBe(300);
  });

  it("subtracts the visual viewport's offset once WebKit slides it down", () => {
    // Same keyboard, but the page scrolled a focused field into view: the
    // visible band moved down, so less of the layout viewport is occluded.
    expect(
      keyboardInset({
        layoutHeight: LAYOUT,
        visualHeight: LAYOUT - 300,
        scale: 1,
        offsetTop: 120,
      }),
    ).toBe(180);
  });

  it("never returns a negative inset", () => {
    expect(
      keyboardInset({
        layoutHeight: LAYOUT,
        visualHeight: LAYOUT - 300,
        scale: 1,
        offsetTop: 999,
      }),
    ).toBe(0);
  });

  it("stays zero under pinch-zoom, matching the keyboard heuristic", () => {
    expect(
      keyboardInset({ layoutHeight: LAYOUT, visualHeight: LAYOUT / 2, scale: 2 }),
    ).toBe(0);
  });
});

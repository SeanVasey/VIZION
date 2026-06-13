import { describe, it, expect } from "vitest";
import { clampOffset, computeMaxOffset } from "@/components/avatar-crop/crop-image";

describe("clampOffset", () => {
  it("passes values within ±max through unchanged", () => {
    expect(clampOffset(0, 10)).toBe(0);
    expect(clampOffset(5, 10)).toBe(5);
    expect(clampOffset(-5, 10)).toBe(-5);
    expect(clampOffset(10, 10)).toBe(10);
    expect(clampOffset(-10, 10)).toBe(-10);
  });

  it("clamps values beyond +max and -max to the boundary", () => {
    expect(clampOffset(25, 10)).toBe(10);
    expect(clampOffset(-25, 10)).toBe(-10);
  });

  it("pins to 0 when max is zero or negative", () => {
    expect(clampOffset(7, 0)).toBe(0);
    expect(clampOffset(-7, 0)).toBe(0);
    expect(clampOffset(7, -3)).toBe(0);
  });
});

describe("computeMaxOffset", () => {
  it("returns 0 for non-positive dimensions or viewport", () => {
    expect(computeMaxOffset(0, 100, 1, 256)).toBe(0);
    expect(computeMaxOffset(100, 0, 1, 256)).toBe(0);
    expect(computeMaxOffset(100, 100, 1, 0)).toBe(0);
  });

  it("returns 0 for a square image at zoom 1 (image exactly fills viewport)", () => {
    // 400x400 cover-fits 256 viewport exactly: no overflow, no pan.
    expect(computeMaxOffset(400, 400, 1, 256)).toBe(0);
  });

  it("returns 0 when the image is smaller than the viewport at zoom 1", () => {
    // Smaller-than-viewport: cover-scale still fills it, square => no slack.
    expect(computeMaxOffset(100, 100, 1, 256)).toBe(0);
  });

  it("allows panning along the longer axis of a landscape image", () => {
    // 800x400: shorter side (400) maps to viewport (256), so coverScale = 0.64.
    // Width scales to 800 * 0.64 = 512; slack = (512 - 256) / 2 = 128.
    expect(computeMaxOffset(800, 400, 1, 256)).toBe(128);
    // The short axis (400) maps exactly to the viewport, so it has no slack.
    expect(computeMaxOffset(400, 800, 1, 256)).toBe(0);
  });

  it("scales the pan slack with zoom on a square image", () => {
    // Square 400x400 at zoom 2: scaledSize = 256 * 2 = 512; slack = 128.
    expect(computeMaxOffset(400, 400, 2, 256)).toBe(128);
    // zoom 1.5: scaledSize = 384; slack = (384 - 256) / 2 = 64.
    expect(computeMaxOffset(400, 400, 1.5, 256)).toBe(64);
  });
});

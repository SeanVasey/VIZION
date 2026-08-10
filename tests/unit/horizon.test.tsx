import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Horizon } from "@/components/editor/Horizon";

const CSS = readFileSync(resolve(process.cwd(), "src/styles/globals.css"), "utf8");

describe("Horizon", () => {
  it("is decorative: hidden from assistive tech, with no text and nothing focusable", () => {
    const { container } = render(<Horizon />);
    const band = container.querySelector(".horizon")!;

    expect(band).not.toBeNull();
    expect(band).toHaveAttribute("aria-hidden", "true");
    // No role, no label, no tab stop, no copy — §5.1. textContent covers the
    // sr-only case too: the orientation sentence lives on the page, not here.
    expect(band.getAttribute("role")).toBeNull();
    expect(band.getAttribute("aria-label")).toBeNull();
    expect(band.textContent).toBe("");
    expect(container.querySelectorAll("[tabindex], a, button, input")).toHaveLength(0);
  });

  it("drives motion from a data attribute so a future state can swap it", () => {
    const { container } = render(<Horizon />);
    expect(container.querySelector(".horizon")).toHaveAttribute("data-state", "idle");
    // The animation must hang off [data-state], not off .horizon-node itself,
    // or an in-flight state could not replace it without editing the keyframe.
    expect(CSS).toMatch(/\.horizon\[data-state="idle"\]\s+\.horizon-node\s*\{/);
  });

  it("keeps the node's rest state inside the designed breathe range", () => {
    // The global reduced-motion collapse ends the animation after one 0.01ms
    // iteration; with no fill-mode the node falls back to these BASE values.
    // That is the whole reduced-motion contract, so pin both halves of it.
    // Anchored to the BARE selector at rule start: `.horizon-node` also
    // appears last in grouped selectors (the world-pause rule), and an
    // unanchored match would read that block instead of the base one.
    const node = /(?:^|\n)\s*\.horizon-node\s*\{([^}]*)\}/.exec(CSS);
    expect(node).not.toBeNull();
    expect(node![1]).toMatch(/opacity:\s*0?\.9\s*;/);
    expect(CSS).not.toMatch(/\.horizon[^{]*\{[^}]*animation-fill-mode/);
  });

  it("animates transform and opacity only, so the breathe stays off the paint path", () => {
    const frames = /@keyframes horizon-breathe\s*\{([\s\S]*?\n  \})/.exec(CSS);
    expect(frames).not.toBeNull();

    const properties = [...frames![1]!.matchAll(/^\s*([a-z-]+):/gm)].map((m) => m[1]!);
    expect(properties.length).toBeGreaterThan(0);
    expect([...new Set(properties)].sort()).toEqual(["opacity", "transform"]);
    // §5.5 — the node animates indefinitely; a permanently promoted layer is
    // not worth it for a 5px element.
    expect(CSS).not.toMatch(/\.horizon[^{]*\{[^}]*will-change/);
  });
});

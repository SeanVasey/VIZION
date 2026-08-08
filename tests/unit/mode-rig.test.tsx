import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ModeRig } from "@/components/editor/ModeRig";
import { MODE_BLURB } from "@/lib/enhance/modes";

function visibleBlurb(): string | undefined {
  const helper = document.getElementById("mode-help-strip");
  const shown = helper?.querySelector('p[aria-hidden="false"]');
  return shown?.textContent ?? undefined;
}

describe("ModeRig", () => {
  it("renders a radiogroup with the active cell checked and the Adapt label", () => {
    render(<ModeRig activeMode="clarify" onSelect={() => {}} />);
    expect(screen.getByRole("radiogroup")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /clarify/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: /adapt/i })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /^target$/i })).toBeNull();
  });

  it("shows the active mode's helper text as plain secondary text (no card)", () => {
    render(<ModeRig activeMode="condense" onSelect={() => {}} />);
    expect(visibleBlurb()).toBe(MODE_BLURB.condense);
    // The audit demoted the onyx card: the helper must not be a bordered surface.
    //
    // This assertion used to match only `bg-onyx|border-hair` — two literal
    // Tailwind names — which made it vacuous the moment a card arrived by a
    // different route: a `.glass` tier draws its hairline, sheen and blur from
    // a CSS rule, so the class string stays "clean" while the rendered element
    // is unmistakably a card. That is not hypothetical; it shipped, and this
    // test stayed green through it. jsdom does not apply the stylesheet, so
    // the honest check available here is the CLASS CONTRACT: name the surface
    // tiers that carry card chrome and forbid all of them. `.ambient-scrim`
    // (a fill, no border/sheen/blur) is the sanctioned backing and is allowed.
    const helper = document.getElementById("mode-help-strip")!;
    const classes = helper.className.split(/\s+/);
    for (const cardTier of [
      "glass",
      "glass-solid",
      "glass-chrome",
      "glass-nav",
      "fab-glass",
    ]) {
      expect(
        classes,
        `#mode-help-strip must not wear the ${cardTier} tier — the 2026-07 audit ` +
          `demoted this helper from a card, and every glass tier restores one. ` +
          `Use .ambient-scrim if it needs a legibility backing.`,
      ).not.toContain(cardTier);
    }
    expect(helper.className).not.toMatch(/bg-onyx|border-hair|border\b|shadow-/);
  });

  it("previews a hovered cell's blurb and falls back to the active mode", () => {
    render(<ModeRig activeMode="clarify" onSelect={() => {}} />);
    const expand = screen.getByRole("radio", { name: /expand/i });
    fireEvent.mouseEnter(expand);
    expect(visibleBlurb()).toBe(MODE_BLURB.expand);
    fireEvent.mouseLeave(expand);
    expect(visibleBlurb()).toBe(MODE_BLURB.clarify);
  });

  it("selects with arrow keys (roving radiogroup)", () => {
    const onSelect = vi.fn();
    render(<ModeRig activeMode="clarify" onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("polish");
  });
});

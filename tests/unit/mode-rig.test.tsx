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
    const helper = document.getElementById("mode-help-strip")!;
    expect(helper.className).not.toMatch(/bg-onyx|border-hair/);
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

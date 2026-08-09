import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Segmented } from "@/components/ui/Segmented";

const OPTIONS = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
  { id: "c", label: "Gamma" },
] as const;

function renderSegmented(value: "a" | "b" | "c" | null, onChange = vi.fn()) {
  render(
    <Segmented label="Test group" options={OPTIONS} value={value} onChange={onChange} />,
  );
  return onChange;
}

describe("Segmented", () => {
  it("renders every option under a named group", () => {
    renderSegmented("a");
    const group = screen.getByRole("group", { name: "Test group" });
    expect(group).toBeTruthy();
    for (const o of OPTIONS) {
      expect(screen.getByRole("button", { name: o.label })).toBeTruthy();
    }
  });

  it("presses exactly the active option", () => {
    renderSegmented("b");
    const pressed = OPTIONS.filter(
      (o) =>
        screen.getByRole("button", { name: o.label }).getAttribute("aria-pressed") ===
        "true",
    );
    expect(pressed.map((o) => o.id)).toEqual(["b"]);
  });

  it("presses nothing when the value is null — the unset state", () => {
    // null is how a rail says "no explicit choice, inherit the default", which
    // must look different from any option being selected.
    renderSegmented(null);
    for (const o of OPTIONS) {
      expect(
        screen.getByRole("button", { name: o.label }).getAttribute("aria-pressed"),
      ).toBe("false");
    }
  });

  it("reports the id, not the label", () => {
    const onChange = renderSegmented("a");
    fireEvent.click(screen.getByRole("button", { name: "Gamma" }));
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("still reports a click on the already-active option", () => {
    // Re-selecting is not a no-op at this layer — a caller may want to treat it
    // as "clear", and swallowing the event here would take that choice away.
    const onChange = renderSegmented("a");
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("uses aria-pressed toggles, not radios", () => {
    // Radios promise arrow-key roving focus this control does not implement.
    renderSegmented("a");
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("never claims the single-primary-action class", () => {
    // btn-laser marks one primary action per surface and composer-reset counts
    // it; a segmented control filling with bg-laser must not join that count.
    const { container } = render(
      <Segmented label="Test group" options={OPTIONS} value="a" onChange={vi.fn()} />,
    );
    expect(container.querySelectorAll(".btn-laser")).toHaveLength(0);
    expect(container.querySelectorAll(".bg-laser")).toHaveLength(1);
  });

  it("never lets a label wrap mid-control", () => {
    // "Few-shot" broke across two lines in the composer's shape rail, which
    // made the rail taller than its neighbours — the reason `fill` exists.
    const { container } = render(
      <Segmented
        label="Test group"
        options={OPTIONS}
        value="a"
        onChange={vi.fn()}
        fill
      />,
    );
    for (const b of container.querySelectorAll("button")) {
      expect(b.className).toContain("whitespace-nowrap");
    }
  });

  it("lays fill segments out as equal columns across the container", () => {
    const { container } = render(
      <Segmented
        label="Test group"
        options={OPTIONS}
        value="a"
        onChange={vi.fn()}
        fill
      />,
    );
    const group = container.querySelector('[role="group"]') as HTMLElement;
    // Inline, not a `grid-cols-${n}` class: Tailwind can't emit a class it
    // never sees in the source, so an interpolated one is missing at runtime.
    expect(group.style.gridTemplateColumns).toBe(
      `repeat(${OPTIONS.length}, minmax(0, 1fr))`,
    );
    expect(group.className).toContain("w-full");
    expect(group.className).not.toContain("inline-flex");
  });

  it("keeps its intrinsic width without fill", () => {
    const { container } = render(
      <Segmented label="Test group" options={OPTIONS} value="a" onChange={vi.fn()} />,
    );
    const group = container.querySelector('[role="group"]') as HTMLElement;
    expect(group.className).toContain("inline-flex");
    expect(group.style.gridTemplateColumns).toBe("");
  });

  it("meets the 44pt tap target on every segment", () => {
    const { container } = render(
      <Segmented label="Test group" options={OPTIONS} value="a" onChange={vi.fn()} />,
    );
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons).toHaveLength(OPTIONS.length);
    for (const b of buttons) {
      expect(b.className).toContain("min-h-[44px]");
    }
  });
});

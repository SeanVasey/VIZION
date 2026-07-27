import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TargetPicker } from "@/components/models/TargetPicker";
import {
  DEVELOPER_LABEL,
  DEVELOPER_ORDER,
  TARGET_MODELS,
  type TargetModelId,
} from "@/lib/constants";

function open(value: TargetModelId = "sonnet_5", onChange = vi.fn()) {
  const utils = render(
    <TargetPicker label="Target model" value={value} onChange={onChange} />,
  );
  fireEvent.click(screen.getByRole("button", { name: /target model/i }));
  return { ...utils, onChange };
}

describe("TargetPicker trigger", () => {
  it("names the current model and its developer mark", () => {
    render(<TargetPicker label="Target model" value="opus_5" onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: /target model/i });
    expect(trigger.textContent).toContain("Opus 5");
    // aria-haspopup tells a screen reader this opens a dialog, not a menu of
    // its own — the Sheet primitive supplies the actual dialog semantics.
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("falls back to the raw id for a value outside the roster", () => {
    // A legacy persisted selection must still render as something rather than
    // an empty pill the user can't interpret.
    render(
      <TargetPicker
        label="Target model"
        value={"gpt_5_5" as TargetModelId}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /target model/i }).textContent).toContain(
      "gpt_5_5",
    );
  });

  it("does not open when disabled", () => {
    render(
      <TargetPicker label="Target model" value="opus_5" onChange={vi.fn()} disabled />,
    );
    fireEvent.click(screen.getByRole("button", { name: /target model/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("TargetPicker sheet", () => {
  it("offers every roster model exactly once", () => {
    open();
    const group = screen.getByRole("radiogroup", { name: /target model/i });
    const rows = within(group).getAllByRole("radio");
    expect(rows).toHaveLength(TARGET_MODELS.length);
    const labels = rows.map((r) => r.textContent ?? "");
    for (const m of TARGET_MODELS) {
      expect(labels.filter((l) => l.includes(m.label))).toHaveLength(1);
    }
  });

  it("groups under developer headers, in DEVELOPER_ORDER", () => {
    open();
    const represented = DEVELOPER_ORDER.filter((d) =>
      TARGET_MODELS.some((m) => m.developer === d),
    );
    const headers = represented.map((d) => DEVELOPER_LABEL[d]);
    const body = screen.getByRole("radiogroup").textContent ?? "";
    // Each header appears, and in roster order — the grouping is the point of
    // the sheet, so the order it renders in must match the locked one.
    let cursor = -1;
    for (const h of headers) {
      const at = body.indexOf(h, cursor + 1);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it("marks exactly the current pick as checked", () => {
    open("kimi_k3");
    const rows = screen.getAllByRole("radio");
    const checked = rows.filter((r) => r.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]!.textContent).toContain("Kimi K3");
  });

  it("reports the picked model and closes", () => {
    const { onChange } = open("sonnet_5");
    fireEvent.click(screen.getByRole("radio", { name: /grok 4\.5/i }));
    expect(onChange).toHaveBeenCalledWith("grok_4_5");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape without reporting a change", () => {
    const { onChange } = open();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

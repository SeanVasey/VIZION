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

  it("implements the radio arrow-key contract: roving tabindex + focus moves (A11Y-002)", () => {
    open("sonnet_5");
    const radios = screen.getAllByRole("radio");
    // Exactly one tab stop — the checked radio.
    const stops = radios.filter((r) => r.getAttribute("tabindex") === "0");
    expect(stops).toHaveLength(1);
    expect(stops[0]!.getAttribute("aria-checked")).toBe("true");
    // ArrowDown moves focus (not selection — picking closes this sheet).
    const group = screen.getByRole("radiogroup");
    stops[0]!.focus();
    fireEvent.keyDown(group, { key: "ArrowDown" });
    const from = radios.indexOf(stops[0]!);
    const next = radios[(from + 1) % radios.length]!;
    expect(document.activeElement).toBe(next);
    expect(next.getAttribute("tabindex")).toBe("0");
    // Home jumps to the first radio.
    fireEvent.keyDown(group, { key: "Home" });
    expect(document.activeElement).toBe(radios[0]);
  });

  it("closes on Escape without reporting a change", () => {
    const { onChange } = open();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("TargetPicker — Auto routing", () => {
  function openWithAuto(auto: boolean) {
    const onChange = vi.fn();
    const onAutoChange = vi.fn();
    render(
      <TargetPicker
        label="Target model"
        value="sonnet_5"
        onChange={onChange}
        auto={auto}
        onAutoChange={onAutoChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /target model/i }));
    return { onChange, onAutoChange };
  }

  it("is not offered unless the caller wires it", () => {
    // Settings must not show it: profiles.default_model is a model_target
    // enum column, and "auto" has nowhere to be stored.
    open();
    expect(screen.queryByRole("radio", { name: /^auto/i })).toBeNull();
  });

  it("offers Auto above the developer groups", () => {
    openWithAuto(false);
    const rows = screen.getAllByRole("radio");
    expect(rows[0]!.textContent).toContain("Auto");
  });

  it("checks Auto and nothing else while routing is on", () => {
    // The fallback id still rides on the wire, but it is not the user's pick
    // and must not render as though it were.
    openWithAuto(true);
    const checked = screen
      .getAllByRole("radio")
      .filter((r) => r.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]!.textContent).toContain("Auto");
  });

  it("turns routing on without reporting a model change", () => {
    const { onChange, onAutoChange } = openWithAuto(false);
    fireEvent.click(screen.getByRole("radio", { name: /^auto/i }));
    expect(onAutoChange).toHaveBeenCalledWith(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("leaves Auto when a model is picked explicitly", () => {
    // Choosing a model IS turning Auto off — a separate toggle would let the
    // two disagree.
    const { onChange, onAutoChange } = openWithAuto(true);
    fireEvent.click(screen.getByRole("radio", { name: /grok 4\.5/i }));
    expect(onAutoChange).toHaveBeenCalledWith(false);
    expect(onChange).toHaveBeenCalledWith("grok_4_5");
  });

  it("reads Auto on the trigger, not the fallback model", () => {
    render(
      <TargetPicker
        label="Target model"
        value="sonnet_5"
        onChange={vi.fn()}
        auto
        onAutoChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: /target model/i });
    expect(trigger.textContent).toContain("Auto");
    expect(trigger.textContent).not.toContain("Sonnet 5");
  });

  it("names the routing preference on the trigger when one is wired", () => {
    // "Auto · Balanced": the budget the hold-slider adjusts must be visible
    // at rest, not only inside the sheet. Settings passes no preference and
    // keeps the bare "Auto" (previous test).
    render(
      <TargetPicker
        label="Target model"
        value="sonnet_5"
        onChange={vi.fn()}
        auto
        onAutoChange={vi.fn()}
        autoPreference="balanced"
        onAutoPreferenceChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: /target model/i });
    expect(trigger.textContent).toContain("Auto · Balanced");
  });
});

describe("TargetPicker — Auto routing preference", () => {
  function openWithPreference(auto = false, autoPreference = "balanced" as const) {
    const onChange = vi.fn();
    const onAutoChange = vi.fn();
    const onAutoPreferenceChange = vi.fn();
    render(
      <TargetPicker
        label="Target model"
        value="sonnet_5"
        onChange={onChange}
        auto={auto}
        onAutoChange={onAutoChange}
        autoPreference={autoPreference}
        onAutoPreferenceChange={onAutoPreferenceChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /target model/i }));
    return { onChange, onAutoChange, onAutoPreferenceChange };
  }

  it("is not offered unless the caller wires it — even with Auto wired", () => {
    // Settings wires neither pair; the composer wires both. A caller that
    // offers Auto without a preference (an older surface) gets the plain row.
    const onAutoChange = vi.fn();
    render(
      <TargetPicker
        label="Target model"
        value="sonnet_5"
        onChange={vi.fn()}
        auto={false}
        onAutoChange={onAutoChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /target model/i }));
    expect(screen.queryByRole("slider", { name: /auto routing preference/i })).toBeNull();
  });

  it("renders one dial, not three radios and not three segments", () => {
    // A second radiogroup nested in the sheet's would break the roving
    // contract (A11Y-002). ADR-0014 replaced the Segmented that solved that
    // with a slider, which solves it the same way — one control, one tab
    // stop — and says the extra thing three equal cells could not: Budget →
    // Quality is a RAMP, and the capsule's growing fill is that ramp.
    openWithPreference();
    const dial = screen.getByRole("slider", { name: /auto routing preference/i });
    expect(dial).toHaveTextContent("Balanced");
    expect(dial.getAttribute("aria-valuetext")).toBe("Balanced");
    expect(screen.queryByRole("group", { name: /auto routing preference/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Quality" })).toBeNull();
  });

  it("keeps the sheet's model radios untouched by the dial", () => {
    // The roving radiogroup's count is a pinned contract — the dial must
    // not leak into it.
    openWithPreference();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(TARGET_MODELS.length + 1); // models + Auto row
  });

  it("adjusting the dial stores the preference AND turns Auto on", () => {
    // Choosing how Auto should route IS choosing Auto — no separate enable
    // step to forget. The sheet deliberately STAYS OPEN: a dial is adjusted
    // and looked at, unlike the segment tap this replaced.
    const { onAutoChange, onAutoPreferenceChange, onChange } = openWithPreference();
    const dial = screen.getByRole("slider", { name: /auto routing preference/i });
    fireEvent.keyDown(dial, { key: "Home" });
    expect(onAutoPreferenceChange).toHaveBeenCalledWith("budget");
    expect(onAutoChange).toHaveBeenCalledWith(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps roving-nav keys inside the dial (Codex review, PR #96)", () => {
    // The dial renders inside the sheet's radiogroup element; without a
    // propagation stop, Arrow/Home/End/PageUp would reach the roving handler,
    // get preventDefault'd, and yank focus onto a model radio mid-adjust.
    openWithPreference();
    const dial = screen.getByRole("slider", { name: /auto routing preference/i });
    dial.focus();
    for (const key of ["ArrowRight", "ArrowDown", "Home", "End", "PageUp", "PageDown"]) {
      fireEvent.keyDown(document.activeElement!, { key });
      expect(document.activeElement).toBe(
        screen.getByRole("slider", { name: /auto routing preference/i }),
      );
    }
  });
});

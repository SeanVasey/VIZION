import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  TARGET_MODELS,
  TARGET_DEVELOPER,
  DEVELOPER_ORDER,
  DEVELOPER_LABEL,
  type Developer,
} from "@/lib/constants";
import { DeveloperIcon } from "@/components/models/DeveloperIcon";
import { TARGETS } from "@/lib/providers/config";

describe("model roster ordering", () => {
  it("groups models by developer in the locked order (Anthropic, OpenAI, then alphabetical)", () => {
    // Developers must appear in DEVELOPER_ORDER, each as one contiguous group.
    const seen: Developer[] = TARGET_MODELS.map((m) => m.developer).filter(
      (d, i, arr) => i === 0 || arr[i - 1] !== d,
    );
    const expected = DEVELOPER_ORDER.filter((d) => seen.includes(d));
    expect(seen).toEqual(expected);
  });

  it("locks Anthropic and OpenAI first, then the rest alphabetically", () => {
    expect(DEVELOPER_ORDER.slice(0, 2)).toEqual(["anthropic", "openai"]);
    const rest = DEVELOPER_ORDER.slice(2);
    expect(rest).toEqual([...rest].sort());
  });

  it("puts the best Anthropic model first (Fable 5 before Opus 5 before Sonnet 5)", () => {
    const ids = TARGET_MODELS.map((m) => m.id);
    expect(ids.indexOf("fable_5")).toBeLessThan(ids.indexOf("opus_5"));
    expect(ids.indexOf("opus_5")).toBeLessThan(ids.indexOf("sonnet_5"));
    expect(ids[0]).toBe("fable_5");
  });

  it("maps every target id to its developer", () => {
    for (const m of TARGET_MODELS) {
      expect(TARGET_DEVELOPER[m.id]).toBe(m.developer);
      expect(DEVELOPER_LABEL[m.developer]).toBeTruthy();
    }
  });

  it("keeps the client-safe developer field in sync with the server provider config", () => {
    // TARGETS (server) and TARGET_MODELS.developer (client) are separate
    // records by design — this pins them together so they can't drift.
    for (const m of TARGET_MODELS) {
      expect(TARGETS[m.id].provider).toBe(m.developer);
      expect(TARGETS[m.id].model).toBeTruthy();
      expect(TARGETS[m.id].priceIn).toBeGreaterThan(0);
      expect(TARGETS[m.id].priceOut).toBeGreaterThan(0);
    }
  });
});

describe("DeveloperIcon", () => {
  it.each(DEVELOPER_ORDER)("renders a currentColor mark for %s", (developer) => {
    const { container } = render(<DeveloperIcon developer={developer} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
    const path = svg!.querySelector("path");
    expect(path).not.toBeNull();
    // Theme green comes from the parent's text colour — never a hardcoded fill.
    expect(path!.getAttribute("fill")).toBe("currentColor");
    expect(path!.getAttribute("d")).toMatch(/^M/);
  });

  it("accepts a size/colour className", () => {
    const { container } = render(
      <DeveloperIcon developer="anthropic" className="h-3.5 w-3.5 text-accent" />,
    );
    expect(container.querySelector("svg")!.getAttribute("class")).toContain(
      "text-accent",
    );
  });

  it("keeps Meta's slot on the thesvg.org infinity mark", () => {
    // Pinned because this mark was once swapped for a hand-drawn glyph:
    // developer marks identify the developer, not the model in the slot.
    // Signature = the opening move + both inner counters of meta/mono.svg.
    const { container } = render(<DeveloperIcon developer="meta" />);
    const d = container.querySelector("path")!.getAttribute("d")!;
    expect(container.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(d.startsWith("M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113")).toBe(true);
    expect(d).toContain("zm10.16 2.053c1.147 0 2.188.758 2.992 1.999");
    expect(d).toContain("zm-10.201.553c1.265 0 2.058.791 2.675 1.446");
  });
});

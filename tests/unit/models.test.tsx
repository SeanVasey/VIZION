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

  it("puts the best Anthropic model first (Fable 5 before Opus 4.8)", () => {
    const ids = TARGET_MODELS.map((m) => m.id);
    expect(ids.indexOf("fable_5")).toBeLessThan(ids.indexOf("opus_4_8"));
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
});

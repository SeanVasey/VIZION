import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { TransformationDiff } from "@/components/diff/TransformationDiff";

const ROOT = join(__dirname, "..", "..");
const CSS = readFileSync(join(ROOT, "src/styles/globals.css"), "utf8");

/** The declarations inside a named rule, as written. */
function ruleBody(selector: string): string {
  const at = CSS.indexOf(`${selector} {`);
  if (at === -1) throw new Error(`rule ${selector} not found in globals.css`);
  return CSS.slice(at, CSS.indexOf("}", at));
}

describe("pinch-zoom survives on the composer (WCAG)", () => {
  it("the viewport still permits zooming", () => {
    const layout = readFileSync(join(ROOT, "src/app/layout.tsx"), "utf8");
    expect(layout).toMatch(/maximumScale:\s*[2-9]/);
    expect(layout).not.toMatch(/userScalable:\s*false/);
  });

  it("the composer chassis declares no touch-action at all", () => {
    // `pan-x pan-y` omits pinch-zoom, so it silently disabled zoom on the
    // app's primary text surface. Any touch-action here would need to be
    // `manipulation` or `pinch-zoom` to keep zoom alive — the honest answer
    // is not to declare one, since the rule exists for overscroll.
    expect(ruleBody(".no-pull-refresh")).not.toContain("touch-action");
  });

  it("still suppresses pull-to-refresh, which is what the rule is for", () => {
    // The overscroll property is the actual mechanism; dropping touch-action
    // must not cost the protection the class was written to provide.
    expect(ruleBody(".no-pull-refresh")).toContain("overscroll-behavior: contain");
  });

  it("and body carries the global overscroll guard besides", () => {
    expect(CSS).toContain("overscroll-behavior-y: none");
  });

  it("no rule disables zoom app-wide", () => {
    // touch-action: none anywhere global would take zoom with it. The only
    // legitimate uses are on elements that own a two-axis drag.
    const globalNone = /(?:^|\n)\s*(?:html|body|\*)\s*\{[^}]*touch-action:\s*none/;
    expect(globalNone.test(CSS)).toBe(false);
  });
});

// --- Share capability gate ---------------------------------------------------

const RESULT = {
  output: "the enhanced prompt",
  rationale: "why",
  diff: [{ op: "equal" as const, text: "the enhanced prompt" }],
  tokenIn: 1,
  tokenOut: 1,
  modelUsed: "claude-opus-5",
  costUsd: 0.001,
  usage: { todayCost: 0.001, capUsd: 5 },
};

function renderResult() {
  render(
    <ToastProvider>
      <TransformationDiff
        input="the enhanced prompt"
        mode="clarify"
        target="opus_5"
        result={RESULT}
      />
    </ToastProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Share is offered only where it exists", () => {
  it("is hidden when the platform has no share sheet", () => {
    // jsdom has no navigator.share. Without the gate this rendered a button
    // that fell through to a clipboard write — a second Copy, one row away,
    // with the "Copied ✓" flash landing on the other button.
    renderResult();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("appears when the platform has one", () => {
    vi.stubGlobal("navigator", {
      ...window.navigator,
      share: vi.fn(),
      clipboard: { writeText: vi.fn() },
    });
    renderResult();
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
  });

  it("never leaves Copy without a way to copy", () => {
    // Hiding Share must not hide the real copy path — that is the whole
    // reason the fallback existed in the first place.
    renderResult();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });
});

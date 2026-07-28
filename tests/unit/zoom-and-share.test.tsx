import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { TransformationDiff } from "@/components/diff/TransformationDiff";

const ROOT = join(__dirname, "..", "..");
const RAW_CSS = readFileSync(join(ROOT, "src/styles/globals.css"), "utf8");

/**
 * Comments stripped. Load-bearing: an earlier version of this file asserted
 * `toContain("overscroll-behavior-y: none")` against the raw text, and the
 * explanatory COMMENT added alongside the fix contained that exact literal —
 * so deleting the real declaration left the test green. A contract test that
 * its own documentation can satisfy is worse than no test.
 */
const CSS = RAW_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * The declarations inside a named rule. Whitespace-tolerant, and it finds
 * EVERY occurrence — a later, more specific rule re-adding the property would
 * be invisible to a first-match search.
 */
function ruleBodies(selector: string): string[] {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "g");
  const bodies: string[] = [];
  for (const m of CSS.matchAll(re)) {
    const from = m.index + m[0].length;
    bodies.push(CSS.slice(from, CSS.indexOf("}", from)));
  }
  if (bodies.length === 0) throw new Error(`rule ${selector} not found in globals.css`);
  return bodies;
}

/** Every declared touch-action value across the app — CSS and inline styles.
 *  A value that omits `pinch-zoom` while restricting panning kills zoom. */
function touchActionValues(): { where: string; value: string }[] {
  const out: { where: string; value: string }[] = [];
  for (const m of CSS.matchAll(/touch-action:\s*([^;}]+)/g)) {
    out.push({ where: "globals.css", value: m[1]!.trim() });
  }
  // Inline React styles, e.g. `touchAction: "pan-y pinch-zoom"`.
  for (const rel of ["src/components/library/use-swipe-actions.ts"]) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    for (const m of src.matchAll(/touchAction:[^"']*["']([^"']+)["']/g)) {
      out.push({ where: rel, value: m[1]!.trim() });
    }
  }
  return out;
}

describe("pinch-zoom survives on the composer (WCAG)", () => {
  it("the viewport still permits zooming", () => {
    const layout = readFileSync(join(ROOT, "src/app/layout.tsx"), "utf8");
    // Any scale of 2 or more, including multi-digit values.
    expect(layout).toMatch(/maximumScale:\s*(?:[2-9]|\d{2,})/);
    expect(layout).not.toMatch(/userScalable:\s*false/);
  });

  it("the composer chassis declares no touch-action at all", () => {
    // `pan-x pan-y` omits pinch-zoom, so it silently disabled zoom on the
    // app's primary text surface. Any touch-action here would need to be
    // `manipulation` or `pinch-zoom` to keep zoom alive — the honest answer
    // is not to declare one, since the rule exists for overscroll.
    for (const body of ruleBodies(".no-pull-refresh")) {
      expect(body).not.toContain("touch-action");
    }
  });

  it("still suppresses pull-to-refresh, which is what the rule is for", () => {
    // The overscroll property is the actual mechanism; dropping touch-action
    // must not cost the protection the class was written to provide.
    expect(ruleBodies(".no-pull-refresh")[0]).toContain("overscroll-behavior: contain");
  });

  it("and body carries the global overscroll guard besides", () => {
    // Asserted STRUCTURALLY, inside the body rule — not as a substring of the
    // whole file, which a comment could satisfy.
    expect(ruleBodies("body")[0]).toContain("overscroll-behavior-y: none");
  });

  it("no touch-action anywhere restricts panning without keeping pinch-zoom", () => {
    // The rule that makes this checkable: `manipulation` and `auto` both allow
    // pinch; any value that names pan axes must also name pinch-zoom, or it
    // silently disables zoom over whatever it covers. `none` is only
    // legitimate on an element owning a two-axis drag (the avatar cropper),
    // which is a Tailwind class rather than a declared value here.
    for (const { where, value } of touchActionValues()) {
      if (value === "auto" || value === "manipulation") continue;
      expect(
        `${where}: ${value}`,
        `${where} declares "${value}", which omits pinch-zoom`,
      ).toContain("pinch-zoom");
    }
  });

  it("actually finds the values it claims to scan", () => {
    // Guards the guard: a regex that matched nothing would pass the test above
    // vacuously, which is exactly the failure this file already shipped once.
    const values = touchActionValues();
    expect(values.length).toBeGreaterThan(1);
    expect(values.some((v) => v.where.endsWith("use-swipe-actions.ts"))).toBe(true);
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

describe("hiding Share doesn't leave a ragged row", () => {
  function actionRow(): HTMLElement {
    const el = screen
      .getByRole("button", { name: "Compare" })
      .closest("div") as HTMLElement;
    return el;
  }

  it("drops the TRACK with the button, not just the node", () => {
    // A three-track grid with two children leaves a dead third column against
    // the full-bleed export strip below. The Copy/Use row above already
    // switches its column count the same way.
    renderResult();
    const row = actionRow();
    expect(row.className).toContain("grid-cols-[1.35fr_1fr]");
    expect(row.className).not.toContain("1fr_1fr]");
  });

  it("keeps three tracks where Share exists", () => {
    vi.stubGlobal("navigator", {
      ...window.navigator,
      share: vi.fn(),
      clipboard: { writeText: vi.fn() },
    });
    renderResult();
    expect(actionRow().className).toContain("grid-cols-[1.35fr_1fr_1fr]");
  });
});

describe("cancelling a share is not a copy", () => {
  it("does nothing when the user dismisses the share sheet", async () => {
    // navigator.share rejects with AbortError on dismiss — the most common
    // outcome of tapping Share. Copying because the user declined to share
    // is the exact surprise this button was fixed for.
    const abort = Object.assign(new Error("share canceled"), { name: "AbortError" });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...window.navigator,
      share: vi.fn().mockRejectedValue(abort),
      clipboard: { writeText },
    });
    renderResult();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(navigator.share).toHaveBeenCalled());
    expect(writeText).not.toHaveBeenCalled();
  });

  it("still falls back when sharing genuinely fails", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...window.navigator,
      share: vi.fn().mockRejectedValue(new Error("NotAllowedError")),
      clipboard: { writeText },
    });
    renderResult();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("the enhanced prompt"));
  });
});

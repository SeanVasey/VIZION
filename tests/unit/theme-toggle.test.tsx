import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useUIStore } from "@/stores/ui";

/**
 * The header theme toggle's categorical marks.
 *
 * The rotated half-circle glyphs (◐ ◑ ◓) told the three modes apart only by
 * rotation — one ambiguous icon — and could not say whether a dark screen
 * was a deliberate choice or the system resolving it. The marks are
 * categorical (sun / moon / machine) and track the STORED setting, never the
 * resolved appearance: that mapping is the feature, so it is pinned here.
 */
vi.mock("@/lib/profile/actions", () => ({
  updateProfileAction: vi.fn().mockResolvedValue({ ok: true }),
}));

import { ThemeToggle } from "@/components/ThemeToggle";

const toggle = () => screen.getByRole("button", { name: /^Theme:/ });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ThemeToggle marks", () => {
  it.each([
    // [stored theme, a path fragment unique to that mark]
    ["light", "M12 2.5v2.5"], // a sun ray
    ["dark", "M20.4 14.2"], // the crescent
    ["system", "M9 21h6"], // the monitor stand
  ] as const)("wears the categorical mark for %s", (theme, fragment) => {
    useUIStore.setState({ theme });
    render(<ThemeToggle />);
    const svg = toggle().querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
    expect(svg!.innerHTML).toContain(fragment);
    // No text codepoint fallback lingers beside the mark (INV-06).
    expect(toggle().textContent).not.toMatch(/[◐◑◓]/);
  });

  it("tracks the stored SETTING, not the resolved appearance", () => {
    // Under "system" the machine mark shows regardless of what the OS would
    // resolve — matchMedia is irrelevant to the mark by design, so a dark
    // screen under "system" and a chosen dark are visually distinct.
    useUIStore.setState({ theme: "system" });
    render(<ThemeToggle />);
    expect(toggle().querySelector("svg")!.innerHTML).toContain("M9 21h6");
  });

  it("keeps the cycle and the spoken label: dark → light → system", () => {
    useUIStore.setState({ theme: "dark" });
    render(<ThemeToggle />);
    expect(toggle().getAttribute("aria-label")).toBe(
      "Theme: dark. Switch to light.",
    );
    fireEvent.click(toggle());
    expect(useUIStore.getState().theme).toBe("light");
    fireEvent.click(toggle());
    expect(useUIStore.getState().theme).toBe("system");
    fireEvent.click(toggle());
    expect(useUIStore.getState().theme).toBe("dark");
  });
});

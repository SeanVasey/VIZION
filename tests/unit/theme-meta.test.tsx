import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeManager } from "@/components/ThemeManager";
import { useUIStore } from "@/stores/ui";

/**
 * The browser-chrome tint contract (DSN-002 / safe-area v2): layout.tsx ships
 * theme-color as a MEDIA-QUALIFIED PAIR (dark-scheme tag first) so the
 * pre-hydration tint follows the OS. Once ThemeManager resolves a concrete
 * theme, that resolution must win over the OS scheme — which means EVERY tag
 * in the pair has to carry the resolved color. Updating only the first match
 * (the old behavior) left the light-media tag untouched, so a light-OS device
 * with the stored theme "dark" tinted its chrome light over a dark page.
 */

const DARK = "#0F1012";
const LIGHT = "#EEF0F4";

/** Recreate layout.tsx's media-qualified pair in the jsdom head. */
function mountMetaPair() {
  for (const [media, color] of [
    ["(prefers-color-scheme: dark)", DARK],
    ["(prefers-color-scheme: light)", LIGHT],
  ] as const) {
    const el = document.createElement("meta");
    el.name = "theme-color";
    el.media = media;
    el.content = color;
    document.head.appendChild(el);
  }
}

function themeColorContents(): string[] {
  return Array.from(
    document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'),
  ).map((el) => el.content);
}

/** Pretend the OS prefers the given scheme. */
function mockOsScheme(scheme: "dark" | "light") {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes("light") ? scheme === "light" : scheme === "dark",
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as never;
}

beforeEach(() => {
  mountMetaPair();
});

afterEach(() => {
  // Unmount BEFORE touching the store or the head: a store reset while
  // ThemeManager is mounted re-runs its effect, which would recreate a meta
  // after the removal below and leak it into the next test.
  cleanup();
  useUIStore.setState({ theme: "system" });
  document.head
    .querySelectorAll('meta[name="theme-color"], meta[name="apple-mobile-web-app-status-bar-style"]')
    .forEach((el) => el.remove());
  vi.restoreAllMocks();
});

describe("ThemeManager writes the resolved tint to the whole theme-color pair", () => {
  it("theme=dark on a light-OS device darkens BOTH tags (the reported stomp)", () => {
    mockOsScheme("light");
    useUIStore.setState({ theme: "dark" });
    render(<ThemeManager />);
    expect(themeColorContents()).toEqual([DARK, DARK]);
  });

  it("theme=light on a dark-OS device lightens BOTH tags", () => {
    mockOsScheme("dark");
    useUIStore.setState({ theme: "light" });
    render(<ThemeManager />);
    expect(themeColorContents()).toEqual([LIGHT, LIGHT]);
  });

  it("theme=system resolves to the OS scheme on BOTH tags", () => {
    mockOsScheme("light");
    useUIStore.setState({ theme: "system" });
    render(<ThemeManager />);
    expect(themeColorContents()).toEqual([LIGHT, LIGHT]);
  });

  it("still creates a tag when none exists (the status-bar meta path)", () => {
    mockOsScheme("dark");
    useUIStore.setState({ theme: "dark" });
    render(<ThemeManager />);
    const statusBar = document.head.querySelector<HTMLMetaElement>(
      'meta[name="apple-mobile-web-app-status-bar-style"]',
    );
    expect(statusBar).not.toBeNull();
    expect(statusBar!.content).not.toBe("");
  });
});

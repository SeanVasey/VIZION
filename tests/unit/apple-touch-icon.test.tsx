import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppleTouchIcon } from "@/components/pwa/AppleTouchIcon";

/**
 * The Home-Screen tile has to be matched to the CURRENT appearance, because
 * that is the only lever iOS gives a web app: it resolves `apple-touch-icon`
 * from the head at "Add to Home Screen", takes the LAST one, and freezes it.
 * `media` is not a lever — measured on device 2026-08-12, iOS evaluates it on
 * `apple-touch-startup-image` but not on icons.
 *
 * Three properties, each of which silently breaks the tile if lost:
 *   • the href matches the scheme (light install → Laser plate, dark → inverse)
 *   • a scheme CHANGE re-points it, so an appearance flip while the page is
 *     open leaves the next capture correct
 *   • it stays LAST in the head, which is what "last one wins" needs
 */

type Listener = () => void;

/** Pretend the OS prefers `scheme`, and hand back a way to flip it. */
function mockOsScheme(scheme: "dark" | "light") {
  const state = { scheme };
  const listeners = new Set<Listener>();
  window.matchMedia = vi.fn((query: string) => ({
    get matches() {
      return query.includes("dark")
        ? state.scheme === "dark"
        : state.scheme === "light";
    },
    media: query,
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
  })) as never;
  return (next: "dark" | "light") => {
    state.scheme = next;
    listeners.forEach((fn) => fn());
  };
}

function appleLinks() {
  return Array.from(
    document.head.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"]'),
  );
}

afterEach(() => {
  cleanup();
  appleLinks().forEach((el) => el.remove());
  vi.restoreAllMocks();
});

describe("AppleTouchIcon — the appearance-matched home-screen tile", () => {
  it("points at the Laser-plate tile under a light appearance", () => {
    mockOsScheme("light");
    render(<AppleTouchIcon />);

    const links = appleLinks();
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("/icons/apple-touch-icon.png");
    expect(links[0]!.getAttribute("sizes")).toBe("180x180");
  });

  it("points at the inverse tile under a dark appearance", () => {
    mockOsScheme("dark");
    render(<AppleTouchIcon />);

    expect(appleLinks()[0]!.getAttribute("href")).toBe(
      "/icons/apple-touch-icon-dark.png",
    );
  });

  it("re-points on a live scheme change, without a reload", () => {
    const setScheme = mockOsScheme("light");
    render(<AppleTouchIcon />);
    expect(appleLinks()[0]!.getAttribute("href")).toBe("/icons/apple-touch-icon.png");

    setScheme("dark");
    expect(appleLinks()[0]!.getAttribute("href")).toBe(
      "/icons/apple-touch-icon-dark.png",
    );

    setScheme("light");
    expect(appleLinks()[0]!.getAttribute("href")).toBe("/icons/apple-touch-icon.png");
  });

  /**
   * Ordering is the whole mechanism. A matched link that is not last loses to
   * whatever follows it under Apple's "last one wins", and the static floor in
   * layout.tsx is exactly such a follower — so this asserts against a stand-in
   * for it rather than against an empty head.
   */
  it("keeps itself last in the head, ahead of the static floor", () => {
    const setScheme = mockOsScheme("light");
    render(<AppleTouchIcon />);

    const staticFloor = document.createElement("link");
    staticFloor.setAttribute("rel", "apple-touch-icon");
    staticFloor.setAttribute("href", "/icons/apple-touch-icon-dark.png");
    document.head.append(staticFloor);
    expect(appleLinks().at(-1)).toBe(staticFloor);

    setScheme("dark");
    const last = appleLinks().at(-1)!;
    expect(last.hasAttribute("data-appearance-matched")).toBe(true);
    expect(last.getAttribute("href")).toBe("/icons/apple-touch-icon-dark.png");
  });

  it("removes its link on unmount, leaving no orphan", () => {
    mockOsScheme("light");
    const { unmount } = render(<AppleTouchIcon />);
    expect(appleLinks()).toHaveLength(1);

    unmount();
    expect(appleLinks()).toHaveLength(0);
  });
});

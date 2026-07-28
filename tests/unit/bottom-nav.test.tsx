import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";

const nav = vi.hoisted(() => ({ pathname: "/enhance" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
}));

// `pending` is driven per-href so a test can put ONE tab in flight, which is
// what actually happens: the tapped tab is pending, its neighbours are not.
const link = vi.hoisted(() => ({ pendingHref: null as string | null }));
vi.mock("next/link", async () => {
  const { createContext, useContext, createElement } = await import("react");
  const HrefContext = createContext<string>("");
  return {
    default: ({
      children,
      href,
      prefetch: _prefetch,
      ...rest
    }: {
      children: React.ReactNode;
      href: string;
      prefetch?: boolean;
    } & Record<string, unknown>) =>
      createElement(
        HrefContext.Provider,
        { value: href },
        createElement("a", { href, ...rest }, children),
      ),
    useLinkStatus: () => ({ pending: useContext(HrefContext) === link.pendingHref }),
  };
});

import { BottomNav } from "@/components/nav/BottomNav";

/** The tab's <a>; `name` matches its visible label. */
function tab(name: string) {
  return screen.getByRole("link", { name });
}

beforeEach(() => {
  nav.pathname = "/enhance";
  link.pendingHref = null;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("BottomNav", () => {
  it("renders the three primary destinations and marks the current one", () => {
    render(<BottomNav />);
    expect(tab("Enhance")).toHaveAttribute("aria-current", "page");
    expect(tab("Library")).not.toHaveAttribute("aria-current");
    expect(tab("Settings")).not.toHaveAttribute("aria-current");
  });

  it("hides itself on the auth gate", () => {
    nav.pathname = "/sign-in";
    render(<BottomNav />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("treats a sub-route as its parent tab", () => {
    nav.pathname = "/library/abc-123";
    render(<BottomNav />);
    expect(tab("Library")).toHaveAttribute("aria-current", "page");
  });

  describe("press feedback", () => {
    it("opts into the shared press affordance", () => {
      // The e2e spec proves `.pressable` resolves to an instant scale in a real
      // engine, but it does so against a hand-written probe element. This is
      // the other half: that the REAL tab carries the class. Without it the
      // stylesheet is correct and the nav still has no scale — which is
      // exactly the regression that shipped when the rule moved off
      // `.nav-tab`, and which the e2e probe could not see because the probe
      // had been updated and the component had not.
      render(<BottomNav />);
      for (const label of ["Enhance", "Library", "Settings"]) {
        expect(tab(label)).toHaveClass("pressable");
      }
    });

    it("marks the tab pressed on pointer-down, before any navigation", () => {
      render(<BottomNav />);
      const library = tab("Library");
      expect(library).not.toHaveAttribute("data-pressed");

      fireEvent.pointerDown(library, { pointerType: "touch" });
      expect(library).toHaveAttribute("data-pressed");
    });

    it("holds the pressed look past a tap too short to see", () => {
      render(<BottomNav />);
      const library = tab("Library");

      fireEvent.pointerDown(library, { pointerType: "touch" });
      fireEvent.pointerUp(library); // ~0ms later, as a decisive thumb would
      // Still lit: releasing on the same frame would be a flicker, not feedback.
      expect(library).toHaveAttribute("data-pressed");

      act(() => void vi.advanceTimersByTime(130));
      expect(library).not.toHaveAttribute("data-pressed");
    });

    it("releases immediately when the press was already long enough", () => {
      render(<BottomNav />);
      const library = tab("Library");

      fireEvent.pointerDown(library, { pointerType: "touch" });
      act(() => void vi.advanceTimersByTime(400)); // a deliberate hold
      fireEvent.pointerUp(library);
      expect(library).not.toHaveAttribute("data-pressed");
    });

    it("clears the press when the scroller claims the gesture", () => {
      render(<BottomNav />);
      const library = tab("Library");

      fireEvent.pointerDown(library, { pointerType: "touch" });
      fireEvent.pointerCancel(library);
      act(() => void vi.advanceTimersByTime(130));
      expect(library).not.toHaveAttribute("data-pressed");
    });

    it("ticks the haptics for a finger but not for a mouse", () => {
      const vibrate = vi.fn();
      vi.stubGlobal("navigator", { ...navigator, vibrate });
      render(<BottomNav />);

      fireEvent.pointerDown(tab("Library"), { pointerType: "mouse" });
      expect(vibrate).not.toHaveBeenCalled();

      fireEvent.pointerDown(tab("Settings"), { pointerType: "touch" });
      expect(vibrate).toHaveBeenCalledTimes(1);
    });

    it("survives a device with no Vibration API", () => {
      vi.stubGlobal("navigator", {});
      render(<BottomNav />);
      expect(() =>
        fireEvent.pointerDown(tab("Library"), { pointerType: "touch" }),
      ).not.toThrow();
    });
  });

  describe("pending navigation", () => {
    it("lights the tapped tab up while its route is still loading", () => {
      link.pendingHref = "/library";
      render(<BottomNav />);

      // The pathname has NOT moved yet — the server render is still in flight.
      expect(tab("Library")).not.toHaveAttribute("aria-current");
      // ...but the destination already reads as selected.
      expect(tab("Library").querySelector(".text-accent")).not.toBeNull();
      expect(tab("Enhance").querySelector(".text-accent")).not.toBeNull();
      expect(tab("Settings").querySelector(".text-accent")).toBeNull();
    });

    it("keeps aria-current on the route the user is actually on", () => {
      // A pending tab must not claim to BE the current page to a screen
      // reader — it isn't one yet, and the announcement would be wrong.
      link.pendingHref = "/library";
      render(<BottomNav />);
      expect(tab("Enhance")).toHaveAttribute("aria-current", "page");
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { InteractionManager } from "@/components/InteractionManager";

const root = () => document.documentElement;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete root().dataset.scrolling;
});

describe("InteractionManager", () => {
  it("renders nothing", () => {
    const { container } = render(<InteractionManager />);
    expect(container).toBeEmptyDOMElement();
  });

  describe("iOS :active enablement", () => {
    it("attaches a passive touch listener so WebKit applies :active styles", () => {
      const add = vi.spyOn(document, "addEventListener");
      render(<InteractionManager />);

      const touch = add.mock.calls.find(([type]) => type === "touchstart");
      expect(
        touch,
        "no touchstart listener — every active: utility is dead on iOS",
      ).toBeDefined();
      // Passive, or the listener it exists purely to register could itself
      // delay a scroll frame — trading one jank for another.
      expect(touch![2]).toMatchObject({ passive: true });
    });

    it("removes the listener on unmount", () => {
      const remove = vi.spyOn(document, "removeEventListener");
      render(<InteractionManager />).unmount();
      expect(remove.mock.calls.some(([type]) => type === "touchstart")).toBe(true);
    });
  });

  describe("data-scrolling", () => {
    it("is absent at rest", () => {
      render(<InteractionManager />);
      expect(root().dataset.scrolling).toBeUndefined();
    });

    it("is set while the page is moving and cleared once it settles", () => {
      render(<InteractionManager />);

      window.dispatchEvent(new Event("scroll"));
      expect(root().dataset.scrolling).toBe("");

      // Still moving 100ms in — the settle window has to bridge the gap
      // between two flicks of a momentum scroll.
      vi.advanceTimersByTime(100);
      expect(root().dataset.scrolling).toBe("");

      vi.advanceTimersByTime(40);
      expect(root().dataset.scrolling).toBeUndefined();
    });

    it("keeps the attribute up across a continuous scroll", () => {
      render(<InteractionManager />);
      for (let i = 0; i < 10; i++) {
        window.dispatchEvent(new Event("scroll"));
        vi.advanceTimersByTime(16);
      }
      expect(root().dataset.scrolling).toBe("");
      vi.advanceTimersByTime(140);
      expect(root().dataset.scrolling).toBeUndefined();
    });

    it("listens in the capture phase — scroll does not bubble past its target", () => {
      // Sheets, the composer and the crop modal are their own scrollers.
      // Without capture, scrolling inside any of them would leave the glass at
      // full cost for the whole gesture.
      const add = vi.spyOn(window, "addEventListener");
      render(<InteractionManager />);
      const scroll = add.mock.calls.find(([type]) => type === "scroll");
      expect(scroll).toBeDefined();
      expect(scroll![2]).toMatchObject({ passive: true, capture: true });
    });

    it("does not strand the attribute when it unmounts mid-scroll", () => {
      const view = render(<InteractionManager />);
      window.dispatchEvent(new Event("scroll"));
      expect(root().dataset.scrolling).toBe("");

      view.unmount();
      expect(root().dataset.scrolling).toBeUndefined();

      // ...and the timer it left behind cannot fire against a live page.
      window.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(200);
      expect(root().dataset.scrolling).toBeUndefined();
    });
  });
});

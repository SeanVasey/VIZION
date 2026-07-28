import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { ScrollStateManager } from "@/components/ScrollStateManager";

const root = () => document.documentElement;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete root().dataset.scrolling;
});

describe("ScrollStateManager", () => {
  it("renders nothing", () => {
    const { container } = render(<ScrollStateManager />);
    expect(container).toBeEmptyDOMElement();
  });

  describe("data-scrolling", () => {
    it("is absent at rest", () => {
      render(<ScrollStateManager />);
      expect(root().dataset.scrolling).toBeUndefined();
    });

    it("is set while the page is moving and cleared once it settles", () => {
      render(<ScrollStateManager />);

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
      render(<ScrollStateManager />);
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
      render(<ScrollStateManager />);
      const scroll = add.mock.calls.find(([type]) => type === "scroll");
      expect(scroll).toBeDefined();
      expect(scroll![2]).toMatchObject({ passive: true, capture: true });
    });

    it("does not strand the attribute when it unmounts mid-scroll", () => {
      const view = render(<ScrollStateManager />);
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

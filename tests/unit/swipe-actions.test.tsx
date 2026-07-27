import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSwipeActions, SWIPE_REVEAL_PX } from "@/components/library/use-swipe-actions";

/** Minimal pointer-event stand-in — the hook reads only these fields. */
const ptr = (x: number, y = 0, pointerType = "touch") =>
  ({ clientX: x, clientY: y, pointerType }) as React.PointerEvent;

function swipe(
  result: { current: ReturnType<typeof useSwipeActions> },
  from: number,
  to: number,
  y = 0,
) {
  act(() => result.current.handlers.onPointerDown(ptr(from)));
  act(() => result.current.handlers.onPointerMove(ptr(to, y)));
  act(() => result.current.handlers.onPointerUp());
}

describe("useSwipeActions", () => {
  it("starts closed and flat", () => {
    const { result } = renderHook(() => useSwipeActions());
    expect(result.current.open).toBeNull();
    expect(result.current.offset).toBe(0);
  });

  it("opens the delete side on a decisive left swipe", () => {
    const { result } = renderHook(() => useSwipeActions());
    swipe(result, 200, 100);
    expect(result.current.open).toBe("right");
    expect(result.current.offset).toBe(-SWIPE_REVEAL_PX);
  });

  it("opens the favorite side on a decisive right swipe", () => {
    const { result } = renderHook(() => useSwipeActions());
    swipe(result, 100, 200);
    expect(result.current.open).toBe("left");
    expect(result.current.offset).toBe(SWIPE_REVEAL_PX);
  });

  it("snaps back when the swipe is too small to count", () => {
    const { result } = renderHook(() => useSwipeActions());
    swipe(result, 200, 175); // 25px — past intent, short of open
    expect(result.current.open).toBeNull();
    expect(result.current.offset).toBe(0);
  });

  it("ignores a gesture that is really a vertical scroll", () => {
    const { result } = renderHook(() => useSwipeActions());
    // Mostly vertical: the list must keep scrolling normally.
    swipe(result, 200, 185, 60);
    expect(result.current.open).toBeNull();
    expect(result.current.offset).toBe(0);
  });

  it("does not move before horizontal intent is established", () => {
    const { result } = renderHook(() => useSwipeActions());
    act(() => result.current.handlers.onPointerDown(ptr(200)));
    act(() => result.current.handlers.onPointerMove(ptr(195))); // 5px
    expect(result.current.offset).toBe(0);
  });

  it("never slides further than one action's width", () => {
    const { result } = renderHook(() => useSwipeActions());
    act(() => result.current.handlers.onPointerDown(ptr(300)));
    act(() => result.current.handlers.onPointerMove(ptr(0)));
    expect(result.current.offset).toBe(-SWIPE_REVEAL_PX);
  });

  it("leaves mouse input alone — swipe is a touch affordance", () => {
    const { result } = renderHook(() => useSwipeActions());
    act(() => result.current.handlers.onPointerDown(ptr(200, 0, "mouse")));
    act(() => result.current.handlers.onPointerMove(ptr(100)));
    expect(result.current.offset).toBe(0);
  });

  it("claims horizontal gestures so the browser can't steal the swipe", () => {
    const { result } = renderHook(() => useSwipeActions());
    // pan-y, not manipulation: the row's <Link> would otherwise let the UA
    // treat a horizontal drag as a pan (or a back-navigation) and cancel the
    // pointer stream instead of delivering it here.
    expect(result.current.style.touchAction).toBe("pan-y");
    expect(result.current.style.transform).toBe("translateX(0px)");
  });

  it("makes no gesture claim when disabled", () => {
    const { result } = renderHook(() => useSwipeActions({ enabled: false }));
    expect(result.current.style.touchAction).toBeUndefined();
  });

  it("carries the offset in the same style object it claims with", () => {
    const { result } = renderHook(() => useSwipeActions());
    swipe(result, 200, 100);
    expect(result.current.style.transform).toBe(`translateX(${-SWIPE_REVEAL_PX}px)`);
    expect(result.current.style.touchAction).toBe("pan-y");
  });

  it("stays inert when disabled", () => {
    const { result } = renderHook(() => useSwipeActions({ enabled: false }));
    swipe(result, 200, 100);
    expect(result.current.open).toBeNull();
  });

  it("closes on scroll, so an open row can't linger off-screen", () => {
    const { result } = renderHook(() => useSwipeActions());
    swipe(result, 200, 100);
    expect(result.current.open).toBe("right");
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.open).toBeNull();
  });

  it("swallows the click that ends a swipe, so the row link doesn't fire", () => {
    const { result } = renderHook(() => useSwipeActions());
    swipe(result, 200, 100);
    let defaultPrevented = false;
    act(() =>
      result.current.onClickCapture({
        preventDefault: () => {
          defaultPrevented = true;
        },
        stopPropagation: () => {},
      } as React.MouseEvent),
    );
    expect(defaultPrevented).toBe(true);
    // …and the row closes rather than staying stuck open.
    expect(result.current.open).toBeNull();
  });
});

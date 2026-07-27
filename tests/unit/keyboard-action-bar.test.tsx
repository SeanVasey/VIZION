import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { KeyboardActionBar } from "@/components/editor/KeyboardActionBar";

/**
 * The bar exists only while the software keyboard does. jsdom has no
 * `visualViewport`, so these tests install one — which is also the proof that
 * the bar stays absent everywhere it should (desktop, server, test env).
 */
const LAYOUT = 852;

function installViewport(sample: { height: number; scale?: number; offsetTop?: number }) {
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: {
      height: sample.height,
      scale: sample.scale ?? 1,
      offsetTop: sample.offsetTop ?? 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
}

beforeEach(() => {
  window.innerHeight = LAYOUT;
});

afterEach(() => {
  Reflect.deleteProperty(window, "visualViewport");
  vi.restoreAllMocks();
});

function renderBar(props: Partial<Parameters<typeof KeyboardActionBar>[0]> = {}) {
  const onEnhance = vi.fn();
  render(
    <KeyboardActionBar
      active
      tokens={42}
      pending={false}
      disabled={false}
      onEnhance={onEnhance}
      {...props}
    />,
  );
  return { onEnhance };
}

describe("KeyboardActionBar", () => {
  it("renders nothing without a visual viewport (desktop, jsdom, server)", () => {
    renderBar();
    expect(screen.queryByRole("button", { name: /enhance/i })).toBeNull();
  });

  it("renders nothing when the composer isn't focused", () => {
    installViewport({ height: LAYOUT - 300 });
    renderBar({ active: false });
    expect(screen.queryByRole("button", { name: /enhance/i })).toBeNull();
  });

  it("appears above an open keyboard, lifted by the measured inset", () => {
    installViewport({ height: LAYOUT - 300 });
    renderBar();
    const button = screen.getByRole("button", { name: /enhance/i });
    expect(button).toBeTruthy();
    // bottom: <inset>px — never 0, which would sit behind the keyboard.
    const bar = button.parentElement as HTMLElement;
    expect(bar.style.bottom).toBe("300px");
    expect(screen.getByText(/42 tokens/)).toBeTruthy();
  });

  it("subtracts the visual viewport offset when WebKit slides it", () => {
    installViewport({ height: LAYOUT - 300, offsetTop: 120 });
    renderBar();
    const bar = screen.getByRole("button", { name: /enhance/i })
      .parentElement as HTMLElement;
    expect(bar.style.bottom).toBe("180px");
  });

  it("stays hidden under pinch-zoom, which is not a keyboard", () => {
    installViewport({ height: LAYOUT / 2, scale: 2 });
    renderBar();
    expect(screen.queryByRole("button", { name: /enhance/i })).toBeNull();
  });

  it("runs the enhance handler and blocks the blur that would unmount it", () => {
    installViewport({ height: LAYOUT - 300 });
    const { onEnhance } = renderBar();
    const button = screen.getByRole("button", { name: /enhance/i });
    // pointerdown must be prevented, or the textarea blurs, the keyboard
    // collapses, and the button unmounts before the click lands.
    const down = fireEvent.pointerDown(button);
    expect(down).toBe(false);
    fireEvent.click(button);
    expect(onEnhance).toHaveBeenCalledTimes(1);
  });

  it("honours the disabled state", () => {
    installViewport({ height: LAYOUT - 300 });
    const { onEnhance } = renderBar({ disabled: true });
    fireEvent.click(screen.getByRole("button", { name: /enhance/i }));
    expect(onEnhance).not.toHaveBeenCalled();
  });
});

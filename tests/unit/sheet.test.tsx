import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Sheet } from "@/components/ui/Sheet";

function Host({
  open = true,
  onClose = () => {},
}: {
  open?: boolean;
  onClose?: () => void;
}) {
  return (
    <div data-testid="host">
      <Sheet open={open} onClose={onClose} title="Test sheet">
        <button type="button">First</button>
        <button type="button">Last</button>
      </Sheet>
    </div>
  );
}

describe("Sheet", () => {
  it("renders nothing when closed", () => {
    render(<Host open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("portals the dialog to <body>, outside the host tree", () => {
    render(<Host />);
    const dialog = screen.getByRole("dialog");
    expect(document.body.contains(dialog)).toBe(true);
    expect(screen.getByTestId("host").contains(dialog)).toBe(false);
  });

  it("labels the dialog with the title", () => {
    render(<Host />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Test sheet");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on scrim click but not on panel click", () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    // The scrim is the dialog's parent wrapper.
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("focuses the panel on open and restores focus on close", () => {
    function Toggle({ open }: { open: boolean }) {
      return (
        <>
          <button type="button" data-testid="opener">
            Open
          </button>
          <Host open={open} />
        </>
      );
    }
    const { rerender } = render(<Toggle open={false} />);
    const opener = screen.getByTestId("opener");
    opener.focus();
    rerender(<Toggle open={true} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    rerender(<Toggle open={false} />);
    expect(document.activeElement).toBe(opener);
  });

  it("wraps Tab focus within the panel", () => {
    render(<Host />);
    const dialog = screen.getByRole("dialog");
    const last = screen.getByRole("button", { name: "Last" });
    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    // Cycles back to the first focusable (the close button in the header).
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  });

  it("wraps a Shift+Tab taken straight after open", () => {
    // The panel itself holds focus on open and is `tabIndex={-1}`, so it never
    // appears in the focusables list. Matching only against `first` therefore
    // left the very first keystroke a keyboard user is likely to make —
    // Shift+Tab, to reach the close button — escaping backwards past a scrim
    // `aria-modal` had just declared impassable.
    // Rendered open from the first render, not toggled — the focus effect has
    // to survive the SSR guard's null pass to reach the panel at all.
    render(<Host />);
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Last" }));
  });

  it("locks body scroll while open and releases it on unmount", () => {
    const { unmount } = render(<Host />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});

describe("Sheet exit", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves the a11y tree at once but keeps painting until the exit ends", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Host open />);
    rerender(<Host open={false} />);
    // To assistive tech (and every caller that queries by role) the close is
    // instant — the exiting node is aria-hidden…
    expect(screen.queryByRole("dialog")).toBeNull();
    // …while the element itself stays mounted for the out animation…
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    // …and unmounts once the backstop elapses (animationend never fires in
    // jsdom, so the timeout is the path under test).
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("releases the scroll lock at exit START, not unmount", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Host open />);
    expect(document.body.style.overflow).toBe("hidden");
    rerender(<Host open={false} />);
    // The exiting node is still mounted, but the page is already usable.
    expect(document.body.style.overflow).toBe("");
  });
});

describe("Sheet drag-to-close", () => {
  function grip(): HTMLElement {
    const el = document.querySelector<HTMLElement>("[data-sheet-grip]");
    if (!el) throw new Error("grab strip not rendered");
    return el;
  }

  it("dismisses when dragged down past the threshold", () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    const zone = grip();
    expect(zone.getAttribute("data-sheet-grip")).toBe("y");
    fireEvent.pointerDown(zone, { pointerId: 1, clientX: 10, clientY: 100, button: 0 });
    fireEvent.pointerMove(zone, { pointerId: 1, clientX: 10, clientY: 120 });
    fireEvent.pointerMove(zone, { pointerId: 1, clientX: 10, clientY: 320 });
    fireEvent.pointerUp(zone, { pointerId: 1, clientX: 10, clientY: 320 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("springs back instead of closing on a short drag", () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    const zone = grip();
    const dialog = screen.getByRole("dialog");
    fireEvent.pointerDown(zone, { pointerId: 1, clientX: 10, clientY: 100, button: 0 });
    fireEvent.pointerMove(zone, { pointerId: 1, clientX: 10, clientY: 130 });
    fireEvent.pointerUp(zone, { pointerId: 1, clientX: 10, clientY: 130 });
    expect(onClose).not.toHaveBeenCalled();
    // The panel is returned to rest, not left mid-drag.
    expect(dialog.style.transform).toBe("");
  });

  it("treats a sub-slop press as a tap, not a drag", () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    const zone = grip();
    const dialog = screen.getByRole("dialog");
    fireEvent.pointerDown(zone, { pointerId: 1, clientX: 10, clientY: 100, button: 0 });
    fireEvent.pointerMove(zone, { pointerId: 1, clientX: 10, clientY: 104 });
    fireEvent.pointerUp(zone, { pointerId: 1, clientX: 10, clientY: 104 });
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog.style.transform).toBe("");
  });
});

describe("Sheet side anchor", () => {
  function SideHost({ onClose = () => {} }: { onClose?: () => void }) {
    return (
      <Sheet open onClose={onClose} title="Side sheet" anchor="side">
        <button type="button">Row</button>
      </Sheet>
    );
  }

  it("renders a horizontal-axis grab rail inside the panel", () => {
    render(<SideHost />);
    const dialog = screen.getByRole("dialog");
    const rail = document.querySelector<HTMLElement>("[data-sheet-grip]");
    expect(rail).not.toBeNull();
    // The rail's axis states the gesture: this card drags OUT to the side.
    expect(rail!.getAttribute("data-sheet-grip")).toBe("x");
    expect(dialog.contains(rail)).toBe(true);
  });

  it("dismisses on a horizontal drag past the threshold", () => {
    const onClose = vi.fn();
    render(<SideHost onClose={onClose} />);
    const rail = document.querySelector<HTMLElement>("[data-sheet-grip]")!;
    fireEvent.pointerDown(rail, { pointerId: 1, clientX: 100, clientY: 10, button: 0 });
    fireEvent.pointerMove(rail, { pointerId: 1, clientX: 120, clientY: 10 });
    fireEvent.pointerMove(rail, { pointerId: 1, clientX: 320, clientY: 10 });
    fireEvent.pointerUp(rail, { pointerId: 1, clientX: 320, clientY: 10 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a click in the column outside the panel", () => {
    const onClose = vi.fn();
    render(<SideHost onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    // The panel's parent is the centering column — a miss inside it counts
    // as a scrim click, exactly like the wrapper itself.
    fireEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog contract: labelled, modal, Escape closes", () => {
    const onClose = vi.fn();
    render(<SideHost onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Side sheet");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Sheet } from "@/components/ui/Sheet";

function Host({ open = true, onClose = () => {} }: { open?: boolean; onClose?: () => void }) {
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

  it("locks body scroll while open and releases it on unmount", () => {
    const { unmount } = render(<Host />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});

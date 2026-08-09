import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AvatarCropper } from "@/components/avatar-crop/AvatarCropper";

/**
 * The dialog contract, driven through a real DOM.
 *
 * jsdom never fires `img.onload`, so the cropper stays in its pre-image state:
 * the zoom slider and "Use photo" are disabled and the focusables are the crop
 * area and Cancel. That is enough for everything here, all of which is about
 * where focus goes rather than what the image does.
 */

function file() {
  return new File([new Uint8Array([1, 2, 3])], "avatar.png", { type: "image/png" });
}

function renderCropper(props: Partial<Parameters<typeof AvatarCropper>[0]> = {}) {
  return render(
    <AvatarCropper file={file()} onCancel={() => {}} onCropped={() => {}} {...props} />,
  );
}

describe("AvatarCropper — the dialog it declares itself to be", () => {
  it("moves focus into the dialog on open", () => {
    renderCropper();
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("wraps a Shift+Tab taken straight after open", () => {
    // The root holds focus and is `tabIndex={-1}`, so it is not in the
    // focusables list — matching only against `first` let the first plausible
    // keystroke escape backwards, past a scrim `aria-modal` says is not there.
    renderCropper();
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });

  it("wraps Tab forward off the last focusable", () => {
    renderCropper();
    const dialog = screen.getByRole("dialog");
    screen.getByRole("button", { name: "Cancel" }).focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("group", { name: "Crop area" }));
  });

  it("describes both non-drag paths on the crop area", () => {
    renderCropper();
    const area = screen.getByRole("group", { name: "Crop area" });
    expect(area).toHaveAccessibleDescription(
      "Drag to pan, tap a point to center it, or use the arrow keys.",
    );
    expect(area.tabIndex).toBe(0);
  });

  it("swallows the arrow keys rather than scrolling the page behind the scrim", () => {
    renderCropper();
    const area = screen.getByRole("group", { name: "Crop area" });
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      expect(fireEvent.keyDown(area, { key })).toBe(false); // false = defaultPrevented
    }
    // Not every key — Tab must still reach the trap, and Escape the host.
    expect(fireEvent.keyDown(area, { key: "Tab" })).toBe(true);
  });
});

describe("AvatarCropper — handing focus back", () => {
  function trigger(disabled = false) {
    const el = document.createElement("button");
    el.textContent = "Change avatar";
    el.disabled = disabled;
    document.body.appendChild(el);
    return el;
  }

  it("returns focus to the named trigger on close", () => {
    const el = trigger();
    const { unmount } = renderCropper({ returnFocusRef: { current: el } });
    unmount();
    expect(document.activeElement).toBe(el);
  });

  it("waits for a trigger that is disabled while the upload runs", async () => {
    // The "Use photo" path sets `avatarBusy` and clears the file in one batch,
    // so the trigger is already disabled when the cleanup runs — and focus()
    // on a disabled control is silently ignored, stranding focus on <body>
    // for the length of a network round trip.
    const el = trigger(true);
    const { unmount } = renderCropper({ returnFocusRef: { current: el } });
    unmount();
    expect(document.activeElement).toBe(document.body);

    el.disabled = false;
    await vi.waitFor(() => expect(document.activeElement).toBe(el));
  });

  it("does not take focus back from wherever the user put it", async () => {
    const el = trigger(true);
    const elsewhere = trigger();
    const { unmount } = renderCropper({ returnFocusRef: { current: el } });
    unmount();

    elsewhere.focus();
    el.disabled = false;
    await new Promise((r) => setTimeout(r, 20));
    expect(document.activeElement).toBe(elsewhere);
  });

  it("ignores a trigger that has left the document", () => {
    const el = trigger();
    const { unmount } = renderCropper({ returnFocusRef: { current: el } });
    el.remove();
    unmount();
    expect(document.activeElement).toBe(document.body);
  });
});

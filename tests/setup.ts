import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * jsdom ships no `PointerEvent` constructor. Testing Library therefore falls
 * back to a plain `Event` for `fireEvent.pointerDown(...)` and silently drops
 * every pointer-specific field — so `e.pointerType` is `undefined` in tests no
 * matter what the call passes, and any code that branches on it (the nav's
 * haptics, the library row's swipe claim) is untestable and quietly asserts
 * the wrong thing. A minimal shim over MouseEvent restores the fields the app
 * actually reads. Defaults match the spec, so tests that don't pass a
 * pointerType keep their existing behaviour.
 */
// `globalThis` widened to a plain record: a `"PointerEvent" in window` guard
// narrows window to `never` in the negative branch (TS knows the property is
// declared), which makes the shim below untypeable.
const globals = globalThis as unknown as Record<string, unknown>;
if (typeof globals.PointerEvent === "undefined") {
  class PointerEventShim extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "";
      this.isPrimary = init.isPrimary ?? false;
    }
  }
  globals.PointerEvent = PointerEventShim;
}

// Ensure the DOM is reset between component tests.
afterEach(() => {
  cleanup();
});

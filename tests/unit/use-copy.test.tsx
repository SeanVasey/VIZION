import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { useCopy } from "@/components/ui/use-copy";
import { tap } from "@/lib/haptics";

/** A probe component so the hook is exercised through a real render. */
function Probe({ text }: { text: string }) {
  const { copied, copy } = useCopy();
  return (
    <button type="button" onClick={() => void copy(text)}>
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

function renderProbe(text = "hello") {
  return render(
    <ToastProvider>
      <Probe text={text} />
    </ToastProvider>,
  );
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "vibrate");
});

describe("useCopy", () => {
  it("writes the text and flashes a confirmation that self-clears", async () => {
    renderProbe("hello");
    const button = screen.getByRole("button");
    await act(async () => {
      button.click();
    });
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(button.textContent).toBe("Copied ✓");

    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(button.textContent).toBe("Copy");
  });

  it("surfaces a blocked clipboard instead of a false confirmation", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    renderProbe();
    await act(async () => {
      screen.getByRole("button").click();
    });
    // Never claims success it didn't achieve.
    expect(screen.getByRole("button").textContent).toBe("Copy");
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't copy/i);
  });

  it("does not set state after the control unmounts mid-flash", async () => {
    const errors: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((e) => errors.push(e));
    const { unmount } = renderProbe();
    await act(async () => {
      screen.getByRole("button").click();
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(errors).toHaveLength(0);
  });
});

describe("haptics", () => {
  it("is a silent no-op where the Vibration API is absent (all of iOS)", () => {
    expect(() => tap()).not.toThrow();
  });

  it("fires a short tick where the API exists (Android/Chromium)", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", {
      value: vibrate,
      configurable: true,
    });
    tap();
    expect(vibrate).toHaveBeenCalledWith(10);
  });

  it("never lets a throwing vibrate break the action that requested it", () => {
    Object.defineProperty(navigator, "vibrate", {
      value: () => {
        throw new Error("not user-activated");
      },
      configurable: true,
    });
    expect(() => tap()).not.toThrow();
  });
});

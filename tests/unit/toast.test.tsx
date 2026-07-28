import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider, useToast } from "@/components/ui/Toast";

function Trigger({ onUndo }: { onUndo?: () => void }) {
  const { toast } = useToast();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          toast({
            text: "Composer cleared",
            ...(onUndo ? { action: { label: "Undo", onAction: onUndo } } : {}),
          })
        }
      >
        fire
      </button>
      <button type="button" onClick={() => toast({ text: "Second toast" })}>
        fire-second
      </button>
      <button
        type="button"
        onClick={() => toast({ text: "Copy failed", tone: "error" })}
      >
        fire-error
      </button>
    </>
  );
}

describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a toast as a status region and auto-dismisses after the duration", () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("fire"));
    expect(screen.getByRole("status")).toHaveTextContent("Composer cleared");
    act(() => {
      vi.advanceTimersByTime(6100);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("runs the action and dismisses on action click", () => {
    const onUndo = vi.fn();
    render(
      <ToastProvider>
        <Trigger onUndo={onUndo} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("fire"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("newest toast wins (one at a time)", () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("fire"));
    fireEvent.click(screen.getByText("fire-second"));
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Second toast");
    expect(screen.queryByText("Composer cleared")).toBeNull();
  });

  it("error tone renders as an alert", () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("fire-error"));
    expect(screen.getByRole("alert")).toHaveTextContent("Copy failed");
  });

  it("useToast throws outside the provider", () => {
    // Silence React's error boundary noise for the intentional throw.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Trigger />)).toThrow(/within <ToastProvider>/);
    spy.mockRestore();
  });
});

/** An action that posts a FOLLOW-UP toast — the "Replace draft" → "Undo"
 *  chain the ?draft= prefill relies on. */
function ChainTrigger() {
  const { toast } = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        toast({
          text: "A prompt was shared",
          action: {
            label: "Replace draft",
            onAction: () =>
              toast({
                text: "Draft replaced",
                action: { label: "Undo", onAction: () => {} },
              }),
          },
        })
      }
    >
      fire-chain
    </button>
  );
}

describe("an action that queues a follow-up toast", () => {
  it("keeps the replacement instead of dismissing it", () => {
    // The action runs before the dismiss, so an unguarded dismiss would wipe
    // the toast the action had just posted and the Undo would never appear.
    render(
      <ToastProvider>
        <ChainTrigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("fire-chain"));
    fireEvent.click(screen.getByRole("button", { name: "Replace draft" }));

    expect(screen.getByText("Draft replaced")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(screen.queryByText("A prompt was shared")).toBeNull();
  });

  it("still dismisses normally when the action posts nothing", () => {
    render(
      <ToastProvider>
        <Trigger onUndo={() => {}} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("fire"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByText("Composer cleared")).toBeNull();
  });
});

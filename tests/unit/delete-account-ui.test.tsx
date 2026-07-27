import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";

/**
 * The delete-account settings row: typed confirmation gates the destructive
 * submit, the native form targets the deletion route, and the redirect-back
 * error banner explains what (didn't) happen.
 */
vi.mock("@/lib/profile/actions", () => ({
  exportDataAction: vi.fn(async () => ({ ok: true, json: "{}" })),
}));
// MediaManager hits Supabase at mount — out of scope here.
vi.mock("@/components/media/MediaManager", () => ({ MediaManager: () => null }));

import { DataPrivacySection } from "@/components/settings/DataPrivacySection";

function renderSection(deleteError?: string) {
  return render(
    <ToastProvider>
      <DataPrivacySection deleteError={deleteError} />
    </ToastProvider>,
  );
}

let submitSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  submitSpy = vi.fn();
  HTMLFormElement.prototype.submit =
    submitSpy as unknown as typeof HTMLFormElement.prototype.submit;
});

describe("Settings delete account", () => {
  it("gates the destructive confirm behind typing DELETE exactly", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    const confirm = screen.getByRole("button", { name: "Delete my account" });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: "delete" } });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: "DELETE" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(submitSpy).toHaveBeenCalledTimes(1);
  });

  it("submits the native form to the deletion route", () => {
    const { container } = renderSection();
    const form = container.querySelector("form[action='/auth/delete-account']");
    expect(form).not.toBeNull();
    expect(form).toHaveAttribute("method", "post");
  });

  it("resets the typed phrase when the sheet reopens", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: "DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    expect(screen.getByRole("button", { name: "Delete my account" })).toBeDisabled();
  });

  it("explains an unconfigured server instead of failing silently", () => {
    renderSection("unconfigured");
    expect(screen.getByRole("alert")).toHaveTextContent(
      /isn't configured on the server yet — nothing was deleted/,
    );
  });

  it("shows no banner for an unknown delete_error value", () => {
    renderSection("bogus");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

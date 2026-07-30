import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import type { Profile } from "@/lib/supabase/database.types";

const routerMock = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

const profileActions = vi.hoisted(() => ({
  updateProfileAction: vi.fn(async () => ({ ok: true })),
  updateEmailAction: vi.fn(async () => ({ ok: true })),
  exportDataAction: vi.fn(async () => ({ ok: true, json: "{}" })),
}));
vi.mock("@/lib/profile/actions", () => profileActions);
vi.mock("@/app/(auth)/actions", () => ({
  setPasswordAction: vi.fn(async () => ({ ok: true })),
}));
// MediaManager hits Supabase at mount — out of scope here.
vi.mock("@/components/media/MediaManager", () => ({ MediaManager: () => null }));

import { SettingsPanel } from "@/components/settings/SettingsPanel";

const PROFILE: Profile = {
  user_id: "u1",
  full_name: "Sean Vasey",
  display_name: "sean",
  email: "sean@example.com",
  avatar_url: null,
  auth_method: "github",
  password_set: true,
  theme: "system",
  default_model: "opus_5",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderPanel(pendingEmail: string | null = null) {
  return render(
    <ToastProvider>
      <SettingsPanel
        profile={PROFILE}
        email="sean@example.com"
        pendingEmail={pendingEmail}
      />
    </ToastProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("Settings identity (form-commit)", () => {
  it("disables Save until something is dirty", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("enables Save when dirty AND valid, and writes through the action", async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Sean A. Vasey" },
    });
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await vi.waitFor(() =>
      expect(profileActions.updateProfileAction).toHaveBeenCalledWith({
        full_name: "Sean A. Vasey",
        display_name: "sean",
      }),
    );
    expect(await screen.findByText("Saved ✓")).toBeTruthy();
  });

  it("keeps Save disabled for an invalid display name and marks the field", () => {
    renderPanel();
    const handle = screen.getByLabelText("Display name");
    fireEvent.change(handle, { target: { value: "X!" } });
    expect(handle).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
});

describe("Display-name rule copy", () => {
  const rule = () => document.getElementById("display-name-rule")!.textContent!;

  it("does not end on a bare glyph, which reads as truncated text", () => {
    renderPanel();
    // Reported as "the text is cutoff". Nothing was clipped — the line ended
    // "- or _", and a low unbracketed underscore at 12px looks like a cut
    // sentence or a caret. Any terminal character but a bare - or _ is fine.
    expect(rule()).not.toMatch(/[-_]\s*$/);
    expect(rule()).toMatch(/hyphen/i);
    expect(rule()).toMatch(/underscore/i);
  });

  it("states the bounds the field actually enforces", () => {
    renderPanel();
    const handle = screen.getByLabelText("Display name");
    const valid = (v: string) => {
      fireEvent.change(handle, { target: { value: v } });
      return handle.getAttribute("aria-invalid") === "false";
    };

    // The copy claims 3–24; assert the field agrees at both edges rather than
    // trusting the numbers, so copy and regex cannot drift apart silently.
    expect(rule()).toContain("3");
    expect(rule()).toContain("24");
    expect(valid("ab")).toBe(false);
    expect(valid("abc")).toBe(true);
    expect(valid("a".repeat(24))).toBe(true);
    expect(valid("a".repeat(25))).toBe(false);

    // And that every class it names is accepted, none it omits is.
    expect(valid("a1-b_c")).toBe(true);
    expect(valid("Abc")).toBe(false);
    expect(valid("a.b")).toBe(false);
  });
});

describe("Settings email (distinct verified workflow)", () => {
  it("shows email read-only — no email input in the identity form", () => {
    renderPanel();
    expect(screen.getByText("sean@example.com")).toBeTruthy();
    expect(screen.queryByLabelText("Email address")).toBeNull();
  });

  it("changes email through the sheet and states the confirmation contract", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Change email" }));
    expect(screen.getByText(/confirmation link to the new address/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("New email address"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send confirmation" }));
    await vi.waitFor(() =>
      expect(profileActions.updateEmailAction).toHaveBeenCalledWith(
        "new@example.com",
      ),
    );
  });

  it("surfaces a pending email change with a resend affordance", () => {
    renderPanel("pending@example.com");
    expect(screen.getByText(/confirmation sent to/i)).toBeTruthy();
    expect(screen.getByText("pending@example.com")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resend" })).toBeTruthy();
  });
});

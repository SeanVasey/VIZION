import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { useUIStore } from "@/stores/ui";
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

function renderPanel(profile: Profile = PROFILE) {
  return render(
    <ToastProvider>
      <SettingsPanel profile={profile} email="sean@example.com" pendingEmail={null} />
    </ToastProvider>,
  );
}

const trigger = () => screen.getByRole("button", { name: /^default model/i });

beforeEach(() => {
  vi.clearAllMocks();
  useUIStore.setState({ targetModel: "opus_5", autoTarget: false });
});

/**
 * The Defaults control (control-commit with rollback), since
 * `profiles.default_model` went nullable (2026-08-15): the picker's Auto row
 * is this control's CLEAR — null = "no stored default → start on Auto" — and
 * the live store is written through on both paths so the composer mirrors
 * what the next load's ProfileHydrator will do.
 */
describe("Settings default model", () => {
  it("stores a concrete pick and writes it through to the live store", async () => {
    renderPanel();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("radio", { name: /grok 4\.5/i }));
    await vi.waitFor(() =>
      expect(profileActions.updateProfileAction).toHaveBeenCalledWith({
        default_model: "grok_4_5",
      }),
    );
    expect(useUIStore.getState().targetModel).toBe("grok_4_5");
    // A concrete default is also the statement "do not open on Auto".
    expect(useUIStore.getState().autoTarget).toBe(false);
    expect(trigger().textContent).toContain("Grok 4.5");
  });

  it("clears to Auto through the picker's Auto row", async () => {
    renderPanel();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("radio", { name: /^auto/i }));
    await vi.waitFor(() =>
      expect(profileActions.updateProfileAction).toHaveBeenCalledWith({
        default_model: null,
      }),
    );
    expect(useUIStore.getState().autoTarget).toBe(true);
    // The last pick survives as Auto's fallback — the store's contract.
    expect(useUIStore.getState().targetModel).toBe("opus_5");
    expect(trigger().textContent).toContain("Auto");
  });

  it("offers the clear WITHOUT the routing dial, in Settings' own words", () => {
    // The preference pair is deliberately not wired here: the routing budget
    // is a per-run knob, not an account default.
    renderPanel();
    fireEvent.click(trigger());
    const row = screen.getByRole("radio", { name: /^auto/i });
    expect(row.textContent).toContain("No default — each session starts on Auto");
    expect(
      screen.queryByRole("slider", { name: /auto routing preference/i }),
    ).toBeNull();
  });

  it("renders a cleared account as Auto from the first paint", () => {
    renderPanel({ ...PROFILE, default_model: null });
    expect(trigger().textContent).toContain("Auto");
    fireEvent.click(trigger());
    const checked = screen
      .getAllByRole("radio")
      .filter((r) => r.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]!.textContent).toContain("Auto");
  });

  it("restores the previous fallback after a failed pick from a cleared account", async () => {
    // Codex review, PR #113: with the account cleared (Auto on, targetModel
    // riding as the device's own fallback), a failed concrete pick must put
    // the OLD fallback back — not leave the rejected model behind, where
    // turning Auto off later would select a model that was never saved.
    profileActions.updateProfileAction.mockResolvedValueOnce({
      ok: false,
      error: "nope",
    } as never);
    useUIStore.setState({ targetModel: "kimi_k3", autoTarget: true });
    renderPanel({ ...PROFILE, default_model: null });
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("radio", { name: /grok 4\.5/i }));
    // Optimistic apply moves both knobs…
    expect(useUIStore.getState().targetModel).toBe("grok_4_5");
    expect(useUIStore.getState().autoTarget).toBe(false);
    // …and the failure restores BOTH: Auto back on, fallback back to the
    // device's own pick.
    await vi.waitFor(() => expect(useUIStore.getState().autoTarget).toBe(true));
    expect(useUIStore.getState().targetModel).toBe("kimi_k3");
    expect(trigger().textContent).toContain("Auto");
  });

  it("rolls back every knob a failed clear touched", async () => {
    profileActions.updateProfileAction.mockResolvedValueOnce({
      ok: false,
      error: "nope",
    } as never);
    renderPanel();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("radio", { name: /^auto/i }));
    // Optimistic apply first…
    expect(useUIStore.getState().autoTarget).toBe(true);
    // …then the failure restores the trigger AND the Auto toggle, or a failed
    // clear would leave the composer on Auto while the account still holds a
    // concrete default.
    await vi.waitFor(() => expect(useUIStore.getState().autoTarget).toBe(false));
    expect(trigger().textContent).toContain("Opus 5");
    expect(useUIStore.getState().targetModel).toBe("opus_5");
  });
});

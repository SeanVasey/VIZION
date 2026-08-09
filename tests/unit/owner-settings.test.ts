import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  DEFAULT_APP_SETTINGS,
  devAccentCss,
  getAppSettings,
  isOwnerEmail,
  isOwnerUser,
} from "@/lib/owner/settings";

/** Minimal client whose app_settings read resolves to the given row. */
function clientWith(row: unknown): SupabaseClient<Database> {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error: null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient<Database>;
}

describe("isOwnerEmail (OWNER_EMAIL is the root of trust)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed when the env var is unset — no one is the owner", () => {
    vi.stubEnv("OWNER_EMAIL", "");
    expect(isOwnerEmail("anyone@example.com")).toBe(false);
  });

  it("matches case- and whitespace-insensitively", () => {
    vi.stubEnv("OWNER_EMAIL", "  Owner@Example.COM ");
    expect(isOwnerEmail("owner@example.com")).toBe(true);
    expect(isOwnerEmail(" OWNER@example.com ")).toBe(true);
  });

  it("rejects every other address, and null/undefined", () => {
    vi.stubEnv("OWNER_EMAIL", "owner@example.com");
    expect(isOwnerEmail("intruder@example.com")).toBe(false);
    expect(isOwnerEmail(null)).toBe(false);
    expect(isOwnerEmail(undefined)).toBe(false);
  });
});

describe("isOwnerUser (recorded claim first, env before/without one)", () => {
  afterEach(() => vi.unstubAllEnvs());

  const settings = (ownerUserId: string | null) => ({
    ownerUserId,
    openAccess: false,
    devAccentStrength: 26,
  });

  it("recognises the recorded claimant regardless of email", () => {
    vi.stubEnv("OWNER_EMAIL", "owner@example.com");
    expect(
      isOwnerUser({ id: "uid-1", email: "other@example.com" }, settings("uid-1")),
    ).toBe(true);
  });

  it("recognises the env-named email before any claim exists", () => {
    vi.stubEnv("OWNER_EMAIL", "owner@example.com");
    expect(isOwnerUser({ id: "uid-2", email: "owner@example.com" }, settings(null))).toBe(
      true,
    );
  });

  it("rejects everyone else, and a missing user", () => {
    vi.stubEnv("OWNER_EMAIL", "owner@example.com");
    expect(
      isOwnerUser({ id: "uid-3", email: "guest@example.com" }, settings("uid-1")),
    ).toBe(false);
    expect(isOwnerUser(null, settings("uid-1"))).toBe(false);
  });
});

describe("devAccentCss (the :root carrier for the stored strength)", () => {
  it("targets :root — the only place dev-accents.css's derivation can see it", () => {
    // --dev-peak is substituted AT :root; a value declared on any descendant
    // (the original wrapper-div carrier) is invisible there. The stored
    // strength rendering at all depends on this selector.
    expect(devAccentCss(34)).toBe(":root{--dev-peak-user:34%}");
  });

  it("clamps to the CHECK-constraint bounds before interpolating into <style>", () => {
    expect(devAccentCss(999)).toBe(":root{--dev-peak-user:60%}");
    expect(devAccentCss(-5)).toBe(":root{--dev-peak-user:0%}");
    expect(devAccentCss(30.6)).toBe(":root{--dev-peak-user:31%}");
  });

  it("falls back to the shipped default on a non-finite value", () => {
    expect(devAccentCss(Number.NaN)).toBe(
      `:root{--dev-peak-user:${DEFAULT_APP_SETTINGS.devAccentStrength}%}`,
    );
  });
});

describe("getAppSettings", () => {
  it("maps the row when it exists", async () => {
    const s = await getAppSettings(
      clientWith({ owner_user_id: "uid-1", open_access: false, dev_accent_strength: 34 }),
    );
    expect(s).toEqual({ ownerUserId: "uid-1", openAccess: false, devAccentStrength: 34 });
  });

  // A missing settings row must never lock everyone out.
  it("fails OPEN to the defaults when the row cannot be read", async () => {
    expect(await getAppSettings(clientWith(null))).toEqual(DEFAULT_APP_SETTINGS);
    expect(DEFAULT_APP_SETTINGS.openAccess).toBe(true);
  });
});

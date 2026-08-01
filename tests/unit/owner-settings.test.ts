import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  DEFAULT_APP_SETTINGS,
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
    expect(
      isOwnerUser({ id: "uid-2", email: "owner@example.com" }, settings(null)),
    ).toBe(true);
  });

  it("rejects everyone else, and a missing user", () => {
    vi.stubEnv("OWNER_EMAIL", "owner@example.com");
    expect(
      isOwnerUser({ id: "uid-3", email: "guest@example.com" }, settings("uid-1")),
    ).toBe(false);
    expect(isOwnerUser(null, settings("uid-1"))).toBe(false);
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

import { describe, it, expect } from "vitest";
import { needsPasswordOnboarding } from "@/lib/auth/onboarding";

describe("needsPasswordOnboarding (D15/A4)", () => {
  it("gates a magic-link account that has not set a password", () => {
    expect(
      needsPasswordOnboarding({ auth_method: "magic_link", password_set: false }),
    ).toBe(true);
  });

  it("clears once the magic-link account has set a password", () => {
    expect(
      needsPasswordOnboarding({ auth_method: "magic_link", password_set: true }),
    ).toBe(false);
  });

  it("never gates OAuth accounts (provider is the credential)", () => {
    expect(needsPasswordOnboarding({ auth_method: "github", password_set: false })).toBe(
      false,
    );
    expect(needsPasswordOnboarding({ auth_method: "google", password_set: false })).toBe(
      false,
    );
  });

  it("treats a missing profile as not-yet-gated", () => {
    expect(needsPasswordOnboarding(null)).toBe(false);
  });
});

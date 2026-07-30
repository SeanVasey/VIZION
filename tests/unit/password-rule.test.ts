import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_RULE_TEXT,
  validatePassword,
} from "@/lib/auth/password";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("password rule", () => {
  it("accepts a password that satisfies length and every class", () => {
    expect(validatePassword("Correct1horse-battery")).toBeNull();
  });

  it("reports length before classes", () => {
    // "needs an uppercase letter" buries the actual problem when the password is
    // six characters long.
    expect(validatePassword("abc")).toBe(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    expect(validatePassword("a".repeat(MIN_PASSWORD_LENGTH - 1))).toMatch(/at least/);
  });

  it("enforces the boundary exactly", () => {
    const atLimit = `Aa1${"x".repeat(MIN_PASSWORD_LENGTH - 3)}`;
    expect(atLimit).toHaveLength(MIN_PASSWORD_LENGTH);
    expect(validatePassword(atLimit)).toBeNull();
    expect(validatePassword(atLimit.slice(0, -1))).toMatch(/at least/);
  });

  it("names every missing class in one message, not one per round trip", () => {
    // All lowercase, long enough: uppercase AND number are both missing.
    const msg = validatePassword("abcdefghijklmnop");
    expect(msg).toBe("Add an uppercase letter and a number.");
  });

  it("names a single missing class without a stray conjunction", () => {
    expect(validatePassword("abcdefghijkl1")).toBe("Add an uppercase letter.");
    expect(validatePassword("ABCDEFGHIJKL1")).toBe("Add a lowercase letter.");
    expect(validatePassword("Abcdefghijklm")).toBe("Add a number.");
  });

  it("does not require symbols, but counts them toward length", () => {
    expect(validatePassword("Aa1!!!!!!!!!")).toBeNull();
    // Symbols are the class most likely to produce a predictable Password1!
    // shape, so they are allowed rather than mandated.
    expect(validatePassword("Aa1xxxxxxxxx")).toBeNull();
  });

  it("does not trim — spaces are legitimate password characters", () => {
    // Trimming would accept a password the user then cannot type back, because
    // Supabase stores what it is given.
    const padded = `  ${"Aa1".padEnd(MIN_PASSWORD_LENGTH - 4, "x")}  `;
    expect(padded.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    expect(validatePassword(padded)).toBeNull();
    expect(validatePassword("   Aa1   ")).toMatch(/at least/);
  });

  it("states the rule in copy that matches what it enforces", () => {
    expect(PASSWORD_RULE_TEXT).toContain(String(MIN_PASSWORD_LENGTH));
    for (const word of ["lowercase", "uppercase", "number"]) {
      expect(PASSWORD_RULE_TEXT).toContain(word);
    }
  });
});

describe("one definition of the rule", () => {
  /**
   * The rule used to be the literal `8`, four times over: a const in the server
   * action and three `minLength={8}` attributes. Raising it meant finding all
   * four, and a miss leaves a form that accepts what the server rejects — or an
   * input that permits less than the server requires.
   */
  const CALLERS = [
    "src/app/(auth)/actions.ts",
    "src/components/auth/SetPasswordForm.tsx",
    "src/components/settings/SettingsPanel.tsx",
  ];

  it("leaves no hardcoded password length at any call site", () => {
    for (const file of CALLERS) {
      const src = read(file);
      expect(src, `${file} still hardcodes minLength`).not.toMatch(/minLength=\{\d+\}/);
      expect(src, `${file} still declares its own minimum`).not.toMatch(/MIN_PASSWORD\s*=/);
    }
  });

  it("has every call site import the shared module", () => {
    for (const file of CALLERS) {
      expect(read(file), `${file} does not import the rule`).toMatch(
        /from "@\/lib\/auth\/password"/,
      );
    }
  });

  it("validates on the SERVER, not only in the markup", () => {
    // `minLength` is a convenience a client can simply not honour.
    expect(read("src/app/(auth)/actions.ts")).toMatch(/validatePassword\(/);
  });

  it("shows the rule to the user on both password forms", () => {
    for (const file of CALLERS.slice(1)) {
      expect(read(file), `${file} never renders the rule`).toMatch(/PASSWORD_RULE_TEXT/);
    }
  });
});

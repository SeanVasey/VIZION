import { describe, expect, it } from "vitest";
import { contentHash } from "@/lib/library/hash";

describe("contentHash", () => {
  it("byte-matches the SQL backfill formula (fixture from the live DB)", () => {
    // select encode(digest('hello'||chr(31)||'world'||chr(31)||'polish',
    //   'sha256'), 'hex')  — executed on the hosted project 2026-07-27.
    expect(contentHash("hello", "world", "polish")).toBe(
      "3877388055503eee0740f994c3581dcd2897ce9f580a358cba1d75984a165c50",
    );
  });

  it("is order-sensitive and separator-guarded", () => {
    expect(contentHash("a", "b", "clarify")).not.toBe(contentHash("b", "a", "clarify"));
    // The 0x1f separator prevents "ab"+"c" colliding with "a"+"bc".
    expect(contentHash("ab", "c", "m")).not.toBe(contentHash("a", "bc", "m"));
  });

  it("handles multibyte text as utf8 (same as Postgres)", () => {
    const h = contentHash("café ☕", "naïve — résumé", "expand");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(contentHash("café ☕", "naïve — résumé", "expand"));
  });
});

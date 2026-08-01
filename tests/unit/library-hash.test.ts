import { describe, expect, it } from "vitest";
import { contentHash } from "@/lib/library/hash";

describe("contentHash", () => {
  it("byte-matches the SQL backfill formula (fixture from the live DB)", () => {
    // select encode(digest('hello'||chr(31)||'world'||chr(31)||'polish'
    //   ||chr(31)||'opus_5', 'sha256'), 'hex')
    // — executed on the hosted project 2026-08-01 (Q5: target joined the
    // formula; the pre-Q5 three-part fixture was pinned 2026-07-27).
    expect(contentHash("hello", "world", "polish", "opus_5")).toBe(
      "ed7fe59f65467baf9681bef517f84e544ed613dc8a9a115b7a3616bcdbc33873",
    );
  });

  it("distinguishes the same content saved for a different target (Q5)", () => {
    expect(contentHash("a", "b", "clarify", "opus_5")).not.toBe(
      contentHash("a", "b", "clarify", "kimi_k3"),
    );
  });

  it("is order-sensitive and separator-guarded", () => {
    expect(contentHash("a", "b", "clarify", "opus_5")).not.toBe(
      contentHash("b", "a", "clarify", "opus_5"),
    );
    // The 0x1f separator prevents "ab"+"c" colliding with "a"+"bc".
    expect(contentHash("ab", "c", "m", "t")).not.toBe(contentHash("a", "bc", "m", "t"));
  });

  it("handles multibyte text as utf8 (same as Postgres)", () => {
    const h = contentHash("café ☕", "naïve — résumé", "expand", "opus_5");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(contentHash("café ☕", "naïve — résumé", "expand", "opus_5"));
  });
});

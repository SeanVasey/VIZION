import { describe, expect, it } from "vitest";
import { buildSecurityHeaders, CSP_DIRECTIVES } from "../../next.config";

/**
 * Transport-dependent hardening.
 *
 * `upgrade-insecure-requests` on a plain-http origin rewrites same-origin
 * subresources to https, where the e2e server (and `next dev`) have no TLS
 * listener — WebKit then renders the app with no CSS at all. Production, on
 * Vercel, is https and must keep the full set. What these tests guard is that
 * the two variants differ by EXACTLY those two headers and never drift further:
 * the https variant is the one production ships, and no e2e run can reach it.
 */

const secure = buildSecurityHeaders(true);
const plain = buildSecurityHeaders(false);

function headerMap(headers: readonly { key: string; value: string }[]) {
  return new Map(headers.map((h) => [h.key, h.value]));
}

function directives(headers: readonly { key: string; value: string }[]) {
  return (headerMap(headers).get("Content-Security-Policy") ?? "").split("; ");
}

describe("security headers by transport", () => {
  it("ships upgrade-insecure-requests and HSTS only on an https origin", () => {
    expect(directives(secure)).toContain("upgrade-insecure-requests");
    expect(headerMap(secure).get("Strict-Transport-Security")).toMatch(/max-age=\d+/);

    expect(directives(plain)).not.toContain("upgrade-insecure-requests");
    expect(headerMap(plain).has("Strict-Transport-Security")).toBe(false);
  });

  it("keeps every other CSP directive identical, so the two can't drift", () => {
    expect(directives(plain)).toEqual(CSP_DIRECTIVES);
    expect(directives(secure).filter((d) => d !== "upgrade-insecure-requests")).toEqual(
      CSP_DIRECTIVES,
    );
  });

  it("keeps every non-transport header identical across both", () => {
    const strip = (headers: readonly { key: string; value: string }[]) =>
      headers
        .filter(
          (h) =>
            h.key !== "Content-Security-Policy" && h.key !== "Strict-Transport-Security",
        )
        .map((h) => `${h.key}: ${h.value}`);
    expect(strip(secure)).toEqual(strip(plain));
  });

  it("still locks down the basics on BOTH transports", () => {
    for (const set of [secure, plain]) {
      const map = headerMap(set);
      const csp = map.get("Content-Security-Policy") ?? "";
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(map.get("X-Frame-Options")).toBe("DENY");
      expect(map.get("X-Content-Type-Options")).toBe("nosniff");
      expect(map.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    }
  });

  it("keeps Supabase reachable for storage previews on both", () => {
    for (const set of [secure, plain]) {
      const csp = headerMap(set).get("Content-Security-Policy") ?? "";
      expect(csp).toMatch(/img-src[^;]*https:\/\/\*\.supabase\.co/);
      expect(csp).toMatch(/media-src[^;]*https:\/\/\*\.supabase\.co/);
    }
  });
});

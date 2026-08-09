import { describe, expect, it } from "vitest";
import { buildSecurityHeaders, staticCspHeader, CSP_DIRECTIVES } from "../../next.config";
import { buildCsp, cspDirectives } from "@/lib/security/csp";

/**
 * CSP + transport-dependent hardening (audit SEC-001 reshaped this):
 * documents get a per-request NONCE policy from the middleware; the
 * middleware-excluded script-bearing assets (offline.html, /offline, sw.js)
 * get a static policy from next.config whose script-src is 'self' alone —
 * the offline recovery script is external (/offline.js) precisely so no
 * variant needs 'unsafe-inline'. These tests pin both variants and the
 * transport split.
 */

const find = (ds: string[], name: string) => ds.find((d) => d.startsWith(`${name} `))!;

describe("nonce policy (documents, via middleware)", () => {
  it("script-src is nonce-based with no unsafe-inline", () => {
    const ds = cspDirectives("https://abcdefgh.supabase.co", "abc123==");
    expect(find(ds, "script-src")).toBe("script-src 'self' 'nonce-abc123=='");
    expect(find(ds, "script-src")).not.toContain("unsafe-inline");
  });

  it("without a nonce (the static asset fallback) script-src is 'self' alone", () => {
    const ds = cspDirectives("https://abcdefgh.supabase.co");
    expect(find(ds, "script-src")).toBe("script-src 'self'");
    expect(find(ds, "script-src")).not.toContain("unsafe-inline");
  });

  it("buildCsp appends upgrade-insecure-requests only on https origins", () => {
    const url = "https://abcdefgh.supabase.co";
    expect(buildCsp(url, { nonce: "n", httpsOrigin: true })).toContain(
      "upgrade-insecure-requests",
    );
    expect(buildCsp(url, { nonce: "n", httpsOrigin: false })).not.toContain(
      "upgrade-insecure-requests",
    );
  });
});

describe("CSP tracks the configured Supabase origin", () => {
  /**
   * The policy used to hardcode `https://*.supabase.co` for every deployment.
   * With 'unsafe-inline' gone the wildcard's remaining risk was as an exfil
   * channel — ANY attacker-registered Supabase project was a valid
   * `connect-src` target — so a configured deployment now gets its EXACT
   * project origin; the wildcard survives only as the no-config fallback.
   */
  const directivesWith = (url: string | undefined) => cspDirectives(url);

  it("narrows a hosted project to its exact origin (no wildcard)", () => {
    const ds = directivesWith("https://abcdefgh.supabase.co");
    expect(find(ds, "connect-src")).toBe(
      "connect-src 'self' https://abcdefgh.supabase.co wss://abcdefgh.supabase.co",
    );
    expect(find(ds, "connect-src")).not.toContain("*.supabase.co");
  });

  it("adds a self-hosted origin to every directive the project appears in", () => {
    const ds = directivesWith("https://db.example.com");
    for (const name of ["connect-src", "img-src", "media-src", "form-action"]) {
      expect(find(ds, name), name).toContain("https://db.example.com");
    }
  });

  it("falls back to the wildcard only when no URL is configured", () => {
    for (const raw of [undefined, "not a url"]) {
      const ds = directivesWith(raw);
      expect(find(ds, "connect-src")).toBe(
        "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      );
    }
  });

  /**
   * supabase-js derives its Realtime endpoint by rewriting the configured
   * URL's protocol (`https:` → `wss:`), and CSP's scheme matching never
   * upgrades `https` to `wss`. So an origin added for REST leaves its own
   * socket blocked unless the ws origin is listed too.
   */
  it("also allows the WebSocket origin supabase-js derives from the same URL", () => {
    const connect = find(directivesWith("https://db.example.com"), "connect-src");
    expect(connect).toContain("https://db.example.com");
    expect(connect).toContain("wss://db.example.com");
  });

  it("derives ws:// for an http origin, as the client does", () => {
    // The e2e stub. `protocol.replace("http", "ws")` yields `ws:`, not `wss:`,
    // and a policy naming the wrong one is the same failure as naming none.
    const connect = find(directivesWith("http://127.0.0.1:54321"), "connect-src");
    expect(connect).toContain("http://127.0.0.1:54321");
    expect(connect).toContain("ws://127.0.0.1:54321");
    expect(connect).not.toContain("wss://127.0.0.1");
  });

  it("keeps the socket origin out of directives where it means nothing", () => {
    // A WebSocket is not an image, a media element or a form target. Only
    // `connect-src` governs one.
    const ds = directivesWith("https://db.example.com");
    for (const name of ["img-src", "media-src", "form-action"]) {
      expect(find(ds, name), name).toContain("https://db.example.com");
      expect(find(ds, name), name).not.toContain("wss://db.example.com");
    }
  });

  it("adds only the ORIGIN, never a path or query from the env value", () => {
    // A stray path in the env var must not end up in the policy.
    const ds = directivesWith("https://db.example.com/rest/v1?k=v");
    expect(find(ds, "connect-src")).toContain("https://db.example.com");
    expect(find(ds, "connect-src")).not.toContain("/rest/v1");
    expect(find(ds, "connect-src")).not.toContain("k=v");
  });
});

describe("security headers by transport", () => {
  const secure = buildSecurityHeaders(true);
  const plain = buildSecurityHeaders(false);

  function headerMap(headers: readonly { key: string; value: string }[]) {
    return new Map(headers.map((h) => [h.key, h.value]));
  }

  it("ships HSTS only on an https origin", () => {
    expect(headerMap(secure).get("Strict-Transport-Security")).toMatch(/max-age=\d+/);
    expect(headerMap(plain).has("Strict-Transport-Security")).toBe(false);
  });

  it("the static asset CSP carries upgrade-insecure-requests only on https", () => {
    expect(staticCspHeader(true).value).toContain("upgrade-insecure-requests");
    expect(staticCspHeader(false).value).not.toContain("upgrade-insecure-requests");
    // And both variants share every other directive byte-for-byte.
    expect(
      staticCspHeader(true)
        .value.split("; ")
        .filter((d) => d !== "upgrade-insecure-requests"),
    ).toEqual(CSP_DIRECTIVES);
    expect(staticCspHeader(false).value.split("; ")).toEqual(CSP_DIRECTIVES);
  });

  it("keeps every non-transport header identical across both", () => {
    const strip = (headers: readonly { key: string; value: string }[]) =>
      headers
        .filter((h) => h.key !== "Strict-Transport-Security")
        .map((h) => `${h.key}: ${h.value}`);
    expect(strip(secure)).toEqual(strip(plain));
  });

  it("still locks down the basics on BOTH transports", () => {
    for (const set of [secure, plain]) {
      const map = headerMap(set);
      expect(map.get("X-Frame-Options")).toBe("DENY");
      expect(map.get("X-Content-Type-Options")).toBe("nosniff");
      expect(map.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    }
    for (const csp of [
      buildCsp(undefined, { nonce: "n", httpsOrigin: true }),
      staticCspHeader(false).value,
    ]) {
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
    }
  });

  it("keeps Supabase storage reachable for previews in both variants", () => {
    for (const csp of [
      buildCsp("https://abcdefgh.supabase.co", { nonce: "n", httpsOrigin: true }),
      buildCsp(undefined, { httpsOrigin: false }),
    ]) {
      expect(csp).toMatch(/img-src[^;]*supabase\.co/);
      expect(csp).toMatch(/media-src[^;]*supabase\.co/);
    }
  });
});

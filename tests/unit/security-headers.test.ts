import { describe, expect, it } from "vitest";
import { buildSecurityHeaders, cspDirectives, CSP_DIRECTIVES } from "../../next.config";

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

describe("CSP tracks the configured Supabase origin", () => {
  /**
   * The policy used to hardcode `https://*.supabase.co`, which silently
   * assumes every deployment is a hosted project on Supabase's own domain. A
   * self-hosted instance or a custom domain is then blocked by `connect-src`
   * with no server-side symptom at all: the browser refuses the request,
   * `signInWithPassword` never resolves, and the app simply never signs anyone
   * in. The e2e stub hit exactly that.
   *
   * `cspDirectives` takes the URL as an argument precisely so this is a plain
   * function call — reading `process.env` inside would make the interesting
   * variants untestable, which is the same trap `buildSecurityHeaders` avoids.
   */
  const directivesWith = (url: string | undefined) => cspDirectives(url);

  const find = (ds: string[], name: string) => ds.find((d) => d.startsWith(`${name} `))!;

  it("adds a self-hosted origin to every directive the wildcard appears in", () => {
    const ds = directivesWith("https://db.example.com");
    for (const name of ["connect-src", "img-src", "media-src", "form-action"]) {
      expect(find(ds, name), name).toContain("https://db.example.com");
    }
  });

  it("leaves a hosted project's policy byte-identical", async () => {
    // The wildcard already covers it; adding the exact origin too would be
    // noise, and any diff here is a silent policy change for every existing
    // deployment.
    const hosted = await directivesWith("https://abcdefgh.supabase.co");
    const unset = await directivesWith(undefined);
    expect(hosted).toEqual(unset);
    expect(find(hosted, "connect-src")).toBe(
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    );
  });

  it("ignores a malformed URL rather than injecting it into the policy", () => {
    const ds = directivesWith("not a url");
    expect(find(ds, "connect-src")).toBe(
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    );
  });

  /**
   * supabase-js derives its Realtime endpoint by rewriting the configured
   * URL's protocol (`https:` → `wss:`), and CSP's scheme matching never
   * upgrades `https` to `wss`. So an origin added for REST leaves its own
   * socket blocked — REST works, every channel is refused, and only on a
   * custom-domain or self-hosted deployment. The hosted wildcard has listed
   * both schemes since day one; the configured origin has to match it.
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

  it("adds only the ORIGIN, never a path or query from the env value", async () => {
    // A stray path in the env var must not end up in the policy.
    const ds = await directivesWith("https://db.example.com/rest/v1?k=v");
    expect(find(ds, "connect-src")).toContain("https://db.example.com");
    expect(find(ds, "connect-src")).not.toContain("/rest/v1");
    expect(find(ds, "connect-src")).not.toContain("k=v");
  });
});

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

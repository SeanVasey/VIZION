import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

/**
 * `updateSession` is the whole authorization gate.
 *
 * Every protected surface in the app is protected by this one function, and it
 * had no tests at all. A typo in `PUBLIC_PREFIXES` — `/lib` instead of
 * `/library`, say — would expose the library to anonymous users, and lint,
 * typecheck, the unit suite and the build would all stay green, because the
 * only specs that touch auth drive the signed-out gate through a browser and
 * never enumerate which paths are public.
 *
 * These assert the branch table directly:
 *
 *   | env      | session | path        | outcome                |
 *   | missing  | –       | /api/*      | 401 JSON               |
 *   | missing  | –       | protected   | redirect /sign-in      |
 *   | missing  | –       | public      | pass through           |
 *   | present  | none    | /api/*      | 401 JSON               |
 *   | present  | none    | protected   | redirect /sign-in      |
 *   | present  | none    | public      | pass through           |
 *   | present  | user    | /sign-in    | redirect /enhance      |
 *   | present  | user    | protected   | pass through           |
 */

const getUser = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

const { updateSession } = await import("@/lib/supabase/middleware");
const { NextRequest } = await import("next/server");

const ENV_URL = "NEXT_PUBLIC_SUPABASE_URL";
const ENV_KEY = "NEXT_PUBLIC_SUPABASE_ANON_KEY";
const saved: Record<string, string | undefined> = {};

function req(path: string) {
  return new NextRequest(new URL(`https://vizion.test${path}`));
}

function signedIn() {
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
}
function signedOut() {
  getUser.mockResolvedValue({ data: { user: null } });
}

beforeEach(() => {
  saved[ENV_URL] = process.env[ENV_URL];
  saved[ENV_KEY] = process.env[ENV_KEY];
  process.env[ENV_URL] = "https://project.supabase.co";
  process.env[ENV_KEY] = "anon-key";
  getUser.mockReset();
});

afterEach(() => {
  for (const k of [ENV_URL, ENV_KEY]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Where a NextResponse redirect points, or null if it isn't one. */
function redirectTo(res: Response): string | null {
  if (res.status < 300 || res.status >= 400) return null;
  const loc = res.headers.get("location");
  return loc ? new URL(loc).pathname : null;
}

describe("updateSession — signed out", () => {
  beforeEach(signedOut);

  it("answers /api/* with a 401 JSON body, not an HTML redirect", async () => {
    // A fetch() that follows a redirect to /sign-in and gets 200 HTML looks
    // like success to the caller. The e2e auth contract depends on this.
    const res = await updateSession(req("/api/enhance"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
    await expect(res.json()).resolves.toEqual({ error: "Authentication required." });
  });

  it.each(["/enhance", "/library", "/library/abc", "/profile", "/"])(
    "redirects %s to the gate",
    async (path) => {
      expect(redirectTo(await updateSession(req(path)))).toBe("/sign-in");
    },
  );

  it.each(["/sign-in", "/auth/callback", "/auth/confirm", "/offline"])(
    "lets %s through",
    async (path) => {
      expect(redirectTo(await updateSession(req(path)))).toBeNull();
    },
  );

  it("matches a public prefix on a segment boundary, not a substring", () => {
    // The bug this guards: `startsWith("/auth")` alone would make a route
    // called `/authors` public. `isPublic` uses `=== p || startsWith(p + "/")`,
    // so these must still be gated.
    return Promise.all(
      ["/sign-in-later", "/authors", "/offline-mode"].map(async (path) => {
        expect(redirectTo(await updateSession(req(path)))).toBe("/sign-in");
      }),
    );
  });

  it("preserves the query when bouncing to the gate", async () => {
    // A shared prompt arrives as /enhance?draft=… — dropping the query on the
    // bounce loses it, which is why the sign-in form re-appends it.
    const res = await updateSession(req("/enhance?draft=abc"));
    const loc = res.headers.get("location");
    expect(loc).not.toBeNull();
    expect(new URL(loc!).search).toBe("?draft=abc");
  });
});

describe("updateSession — signed in", () => {
  beforeEach(signedIn);

  it("sends an authenticated visitor off the gate", async () => {
    expect(redirectTo(await updateSession(req("/sign-in")))).toBe("/enhance");
  });

  it.each(["/enhance", "/library", "/profile", "/api/enhance"])(
    "lets %s through",
    async (path) => {
      const res = await updateSession(req(path));
      expect(res.status).toBe(200);
      expect(redirectTo(res)).toBeNull();
    },
  );

  it("validates the token instead of trusting the cookie", async () => {
    // getUser() revalidates with Supabase Auth; getSession() would trust an
    // unverified cookie. The comment in the source says so — this makes it
    // fail if someone swaps the call.
    await updateSession(req("/library"));
    expect(getUser).toHaveBeenCalled();
  });
});

describe("updateSession — Supabase not configured", () => {
  beforeEach(() => {
    delete process.env[ENV_URL];
    delete process.env[ENV_KEY];
  });

  it("fails closed on /api/* rather than serving the route", async () => {
    const res = await updateSession(req("/api/enhance"));
    expect(res.status).toBe(401);
  });

  it("fails closed on a protected page", async () => {
    expect(redirectTo(await updateSession(req("/library")))).toBe("/sign-in");
  });

  it("still serves the gate itself, so the app can explain itself", async () => {
    expect(redirectTo(await updateSession(req("/sign-in")))).toBeNull();
  });

  it("never calls Supabase when it has no credentials", async () => {
    await updateSession(req("/library"));
    expect(getUser).not.toHaveBeenCalled();
  });
});

describe("middleware matcher — the paths the gate never sees", () => {
  /**
   * The matcher is the OTHER half of the authorization story: a path it
   * excludes bypasses `updateSession` entirely, so an exclusion is a public
   * asset by fiat and a missing exclusion silently subjects a static asset to
   * the auth redirect. Both failure modes have shipped: /robots.txt spent its
   * life 307ing to /sign-in, and /offline.js — the offline page's recovery
   * script — would have been auth-redirected during the SW's install-time
   * precache on /sign-in, caching sign-in HTML under the script's key and
   * killing offline recovery a second way (caught by Codex review on PR #76).
   * Next compiles the pattern via path-to-regexp; anchoring it ^…$ models the
   * same decision for whole pathnames.
   */
  const matcherRegex = (async () => {
    const { config } = await import("@/middleware");
    return new RegExp(`^${(config.matcher as string[])[0]}$`);
  })();

  it.each([
    "/offline.html",
    "/offline",
    "/offline.js",
    "/sw.js",
    "/robots.txt",
    "/favicon.ico",
    "/manifest.webmanifest",
    "/icons/icon-192.png",
    "/splash/splash-828x1792.png",
    "/brand/vizion-icon-light.svg",
  ])("excludes the static asset %s", async (path) => {
    expect((await matcherRegex).test(path)).toBe(false);
  });

  it.each([
    "/",
    "/sign-in",
    "/enhance",
    "/library",
    "/api/enhance",
    "/offline-mode", // a hypothetical APP route: only the exact static names are exempt
  ])("still runs on %s", async (path) => {
    expect((await matcherRegex).test(path)).toBe(true);
  });
});

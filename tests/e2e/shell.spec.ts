import { test, expect } from "@playwright/test";

test.describe("VIZ(IO)N shell + auth gate", () => {
  test("unauthenticated root redirects to the sign-in gate", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in$/);
    // R2.4: the wordmark reads plain "VIZION" (IO in accent); brackets/chevron
    // moved to the brand mark/icon, so its accessible name is "VIZION".
    await expect(page.getByRole("img", { name: "VIZION" })).toBeVisible();
    await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Continue with GitHub/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Continue with Google/i }),
    ).toBeVisible();
  });

  test("protected routes redirect to the gate when signed out", async ({ page }) => {
    for (const path of ["/enhance", "/library", "/profile"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/sign-in$/);
    }
  });

  test("the gate honours the stored theme via data-theme", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.locator("html")).toHaveAttribute("data-theme", /dark|light|system/);
  });

  test("manifest is reachable and declares any + maskable icons", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok()).toBeTruthy();
    const manifest = await res.json();
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color).toBe("#0F1012");
    const purposes = new Set(manifest.icons.map((i: { purpose: string }) => i.purpose));
    expect(purposes.has("any")).toBeTruthy();
    expect(purposes.has("maskable")).toBeTruthy();
  });

  test("the enhance API rejects unauthenticated requests with 401", async ({
    request,
  }) => {
    const res = await request.post("/api/enhance", {
      data: { input: "write a summary", mode: "clarify", target: "opus_5" },
    });
    expect(res.status()).toBe(401);
  });

  test("the media API rejects unauthenticated requests with 401", async ({ request }) => {
    const res = await request.post("/api/media", {
      data: { dataUrl: "data:image/jpeg;base64,AAAA" },
    });
    expect(res.status()).toBe(401);
  });

  test("sends a locked-down Content-Security-Policy", async ({ request }) => {
    const res = await request.get("/sign-in");
    const csp = res.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    // This server is plain http, so `upgrade-insecure-requests` must NOT be
    // here: it would rewrite every same-origin subresource to https, where
    // nothing is listening, and WebKit (unlike Chromium, which exempts
    // loopback) would then render every page with no CSS at all. The https
    // variant, which production gets, is pinned in
    // tests/unit/security-headers.test.ts.
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(res.headers()["strict-transport-security"]).toBeUndefined();
  });

  test("exposes a skip-to-content link for keyboard users", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeAttached();
  });

  test("a keyboard-focused glass control still shows the focus ring", async ({
    page,
  }) => {
    // WCAG 2.4.7, pinned in a real browser because the failure mode is a
    // cascade-LAYER win rather than a specificity one: a components-layer
    // `box-shadow` on `.glass` silently replaced the base-layer
    // :focus-visible ring, and these inputs also carry `focus:outline-none`,
    // so a keyboard user got no focus indicator at all. Only a real engine
    // resolves layers, so this cannot be a unit test.
    await page.goto("/sign-in");
    const email = page.locator("input#email");
    await expect(email).toHaveClass(/\bglass\b/); // the fix is about .glass
    await email.focus();

    const ring = await email.evaluate((el) => ({
      focusVisible: el.matches(":focus-visible"),
      boxShadow: getComputedStyle(el).boxShadow,
    }));
    expect(ring.focusVisible).toBe(true);
    // The ring is an OUTSET spread; the sheen is `inset`. Requiring a non-inset
    // layer is what distinguishes "ring + sheen" from "sheen alone".
    const layers = ring.boxShadow.split(/,(?![^(]*\))/);
    expect(layers.some((l) => !l.includes("inset"))).toBe(true);
    expect(ring.boxShadow).not.toBe("none");
  });

  test("scrolls smoothly without animating route-change scroll restoration", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    // Both halves matter: the CSS is what makes an in-page scroll glide, and
    // the attribute is what tells Next to keep suppressing it around its own
    // scroll restoration (from v16 it only does so when the attribute is
    // present — without it every route change would GLIDE to the top).
    await expect(page.locator("html")).toHaveAttribute(
      "data-scroll-behavior",
      "smooth",
    );
    expect(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).scrollBehavior,
      ),
    ).toBe("smooth");
  });

  test("glass stands its backdrop blur down while the page is moving", async ({
    page,
  }) => {
    // Same class of bug as the focus-ring test above, and unreachable from a
    // unit test for the same reason: `.glass` declares `backdrop-filter` in
    // the components layer and the scroll gate overrides it from the
    // utilities layer, so only a real engine can say which one wins.
    await page.goto("/sign-in");
    const email = page.locator("input#email");
    await expect(email).toHaveClass(/\bglass\b/);

    const blurAtRest = await email.evaluate(
      (el) => getComputedStyle(el).backdropFilter,
    );
    expect(blurAtRest).toContain("blur");

    // Drive the real listener rather than stamping the attribute by hand.
    await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
    await expect(page.locator("html")).toHaveAttribute("data-scrolling", "");
    expect(await email.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe(
      "none",
    );

    // ...and it comes back on its own once the page settles.
    await expect(page.locator("html")).not.toHaveAttribute("data-scrolling", "");
    expect(
      await email.evaluate((el) => getComputedStyle(el).backdropFilter),
    ).toContain("blur");
  });

  test("the service worker is served with a no-store cache policy", async ({
    request,
  }) => {
    const res = await request.get("/sw.js");
    expect(res.ok()).toBeTruthy();
    expect(res.headers()["cache-control"]).toContain("no-cache");
  });

  test("registers a service worker and serves the offline fallback", async ({
    page,
    context,
    browserName,
  }) => {
    // Playwright WebKit's service-worker + offline emulation is unreliable
    // (`serviceWorker.ready` hangs, `reload()` throws internal errors), so the
    // SW lifecycle + offline fallback are verified on Chromium.
    test.skip(
      browserName === "webkit",
      "Playwright WebKit service-worker support is unreliable; verified on Chromium.",
    );

    await page.goto("/sign-in");
    await page.evaluate(() => navigator.serviceWorker.ready);

    await page.waitForFunction(
      () => navigator.serviceWorker?.controller !== null,
      undefined,
      { timeout: 20_000 },
    );

    // A never-visited protected route, while offline, falls through to the
    // precached static offline.html (auth-agnostic shell).
    await context.setOffline(true);
    await page.goto("/enhance");
    await expect(page.getByRole("heading", { name: "VIZ(IO)N" })).toBeVisible();
    await expect(page.locator("body")).toContainText(/offline/i);
    await context.setOffline(false);
  });
});

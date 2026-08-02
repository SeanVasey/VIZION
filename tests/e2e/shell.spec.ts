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
    // The document CSP is nonce-based with NO 'unsafe-inline' for scripts
    // (audit SEC-001): the middleware mints a per-request nonce that the
    // theme bootstrap and Next's inline scripts carry.
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+'/);
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
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

  test("the floating action button is a frosted lens, and keeps its ring", async ({
    page,
  }) => {
    // The FAB is behind auth, so this pins the STYLESHEET contract the same
    // way the nav test below does — and for the same reason: every claim here
    // is a cascade-layer or paint-order outcome that no unit test can answer.
    //
    // Three of them, all previously wrong or absent on this button:
    //   1. the Laser fill is TRANSLUCENT and lives on the ::before, because a
    //      backdrop-filter on the fixed button itself detaches it from the
    //      viewport edge in WebKit;
    //   2. the blur is on that pseudo and NOT on the button;
    //   3. focusing it still produces a ring. It used to carry the depth
    //      shadow as a `shadow-[…]` utility, and a utility-layer box-shadow
    //      beats the base-layer `:focus-visible` rule at equal specificity —
    //      so a keyboard user got no indicator at all.
    await page.goto("/sign-in");
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<a id="probe-before" href="#">a</a>
         <button id="probe-fab" class="pressable btn-laser fab-glass rounded-full">+</button>`,
      );
    });

    const surface = await page.evaluate(() => {
      const el = document.querySelector("#probe-fab")!;
      const own = getComputedStyle(el);
      const lens = getComputedStyle(el, "::before");
      // color-mix serializes as `rgba(r, g, b, a)` in some engines and
      // `color(srgb r g b / a)` in others; both omit alpha entirely when it
      // is 1, which is the case this has to be able to fail on.
      const alpha = (v: string) =>
        Number(/\/\s*([\d.]+)\s*\)/.exec(v)?.[1] ?? /,\s*([\d.]+)\s*\)$/.exec(v)?.[1] ?? 1);
      // WebKit only answers to the prefixed name, and it is not on the
      // CSSStyleDeclaration type either — read both by property name.
      const backdrop = (s: CSSStyleDeclaration) =>
        s.backdropFilter || s.getPropertyValue("-webkit-backdrop-filter");
      return {
        ownBackdrop: backdrop(own),
        ownBackgroundAlpha: alpha(own.backgroundColor),
        lensBackdrop: backdrop(lens),
        lensAlpha: alpha(lens.backgroundColor),
        restLayers: own.boxShadow.split(/,(?![^(]*\))/).length,
      };
    });

    // Blur on the pseudo, never on the fixed button.
    expect(surface.lensBackdrop).toContain("blur");
    expect(surface.ownBackdrop === "none" || surface.ownBackdrop === "").toBe(true);
    // The tint moved to the pseudo with it — a tint left on the button would
    // be inside the pseudo's own backdrop and get blurred instead of layered.
    expect(surface.ownBackgroundAlpha).toBe(0);
    // Frosted, not solid, and not so thin the accent stops carrying.
    expect(surface.lensAlpha).toBeGreaterThanOrEqual(0.7);
    expect(surface.lensAlpha).toBeLessThan(1);

    // Arrive by keyboard: buttons only match :focus-visible after a keyboard
    // interaction, so a bare .focus() would prove nothing.
    await page.locator("#probe-before").focus();
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.querySelector("#probe-fab")!;
      return {
        isFocusVisible: el.matches(":focus-visible"),
        boxShadow: getComputedStyle(el).boxShadow,
      };
    });
    expect(focused.isFocusVisible).toBe(true);
    // The ring is COMPOSED in front of the resting shadow rather than
    // replacing it, so focusing adds layers instead of swapping them.
    expect(focused.boxShadow.split(/,(?![^(]*\))/).length).toBeGreaterThan(
      surface.restLayers,
    );
  });

  test("the nav's press affordance is instant down and eased up", async ({ page }) => {
    // The bottom bar is behind auth, so this pins the STYLESHEET contract
    // rather than a live tab — same approach as the focus-ring test above, and
    // for the same reason: only a real engine resolves cascade layers, and
    // `.nav-tab` is a components-layer rule whose pressed variant has to beat
    // its own resting rule.
    //
    // The asymmetry is the point and is why this is not `active:scale-95`: the
    // press lands with NO transition — a ramp on the way down is the lag the
    // affordance exists to disprove — while the release keeps its ease-out.
    // Tailwind cannot express a one-directional duration, so a future
    // "simplification" back to a utility would quietly undo it.
    await page.goto("/sign-in");
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<a id="probe-rest" class="pressable nav-tab" href="#">a</a>
         <a id="probe-press" class="pressable nav-tab" href="#" data-pressed>b</a>`,
      );
    });

    const read = (id: string) =>
      page.evaluate((sel) => {
        const el = document.querySelector(sel)!;
        const own = getComputedStyle(el);
        return {
          transform: own.transform,
          duration: own.transitionDuration,
          washOpacity: getComputedStyle(el, "::before").opacity,
        };
      }, `#${id}`);

    const rest = await read("probe-rest");
    const pressed = await read("probe-press");

    // Pressed: visibly scaled, wash fully up, and no ramp on either.
    expect(pressed.transform).not.toBe("none");
    expect(pressed.transform).not.toBe(rest.transform);
    expect(Number(pressed.washOpacity)).toBe(1);
    expect(new Set(pressed.duration.split(", "))).toEqual(new Set(["0s"]));

    // At rest: unscaled, wash invisible, and a real ease-out to return on.
    expect(
      rest.transform === "none" || rest.transform === "matrix(1, 0, 0, 1, 0, 0)",
    ).toBe(true);
    expect(Number(rest.washOpacity)).toBe(0);
    expect(rest.duration.split(", ").some((d) => parseFloat(d) > 0)).toBe(true);
  });

  test("scrolls smoothly without animating route-change scroll restoration", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    // Both halves matter: the CSS is what makes an in-page scroll glide, and
    // the attribute is what tells Next to keep suppressing it around its own
    // scroll restoration (from v16 it only does so when the attribute is
    // present — without it every route change would GLIDE to the top).
    await expect(page.locator("html")).toHaveAttribute("data-scroll-behavior", "smooth");
    expect(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).scrollBehavior,
      ),
    ).toBe("smooth");
  });

  test("glass keeps its appearance while the page is moving", async ({
    page,
  }) => {
    // The scroll gate must not touch `.glass`. Two stand-down generations
    // were falsified on device (2026-08): blur-off made panels see-through
    // mid-flick, and an opaque fill swap made the greys visibly shift. Only
    // a real engine can prove the cascade leaves a panel computing the SAME
    // blur and fill mid-scroll as at rest — which is exactly the regression
    // this pins. (The FAB keeps its own gate; unit-tested.)
    await page.goto("/sign-in");
    const email = page.locator("input#email");
    await expect(email).toHaveClass(/\bglass\b/);

    const atRest = await email.evaluate((el) => {
      const s = getComputedStyle(el);
      return { blur: s.backdropFilter, fill: s.backgroundColor };
    });
    expect(atRest.blur).toContain("blur");

    // Drive the real listener rather than stamping the attribute by hand.
    await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
    await expect(page.locator("html")).toHaveAttribute("data-scrolling", "");
    expect(
      await email.evaluate((el) => {
        const s = getComputedStyle(el);
        return { blur: s.backdropFilter, fill: s.backgroundColor };
      }),
    ).toEqual(atRest);

    // ...and the attribute still clears once the page settles (the FAB's gate
    // depends on the stamp lifecycle staying alive).
    await expect(page.locator("html")).not.toHaveAttribute("data-scrolling", "");
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

import { test, expect } from "@playwright/test";

test.describe("VIZION shell + auth gate", () => {
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

  test("the brand mark and the wordmark accent are one green, in both themes", async ({
    page,
  }) => {
    // The header regression, generalized (R1.1 / ScreenHeader): a plated tile
    // painted a GRADIENT green beside a wordmark reading the flat --accent-ink,
    // and the two visibly disagreed. Both surfaces now take the accent through
    // `currentColor` / text-accent, so they must compute the identical rgb — a
    // hardcoded fill sneaking back into either is what this catches. Real engine
    // because it is a resolved-cascade fact, and in BOTH polarities because the
    // light accent (#526810) is a different token, not a tint of the dark Laser.
    await page.goto("/sign-in");
    const mark = page.locator('svg[viewBox="0 0 1024 892.8"]').first();
    const word = page.getByRole("img", { name: "VIZION" });
    const ioSpan = word.locator("span").nth(1); // VIZ · IO · N — the accent pair
    await expect(ioSpan).toHaveText("IO");

    await expect(mark).toBeVisible();
    for (const theme of ["dark", "light"] as const) {
      // Read all three in ONE evaluate so they share a single computed-style
      // snapshot — a getComputedStyle forces a synchronous resolve, so no stale
      // frame can slip between the reads (the recompute-lag WebKit shows under
      // load when an attribute set and a read are separate round-trips).
      const colors = await page.evaluate((t) => {
        document.documentElement.dataset.theme = t;
        const markEl = document.querySelector('svg[viewBox="0 0 1024 892.8"]')!;
        const spans = document
          .querySelector('[role="img"][aria-label="VIZION"]')!
          .querySelectorAll("span");
        return {
          mark: getComputedStyle(markEl).color,
          io: getComputedStyle(spans[1]!).color, // VIZ · IO · N — the accent pair
          text: getComputedStyle(spans[0]!).color,
        };
      }, theme);
      // Same accent on both brand surfaces…
      expect(colors.io, `mark≠wordmark accent on ${theme}`).toBe(colors.mark);
      // …and it is genuinely the accent, not both collapsing to the ink colour.
      expect(colors.mark, `accent==text on ${theme}`).not.toBe(colors.text);
    }
  });

  test("the icon head declares both home-screen appearances, dark-last", async ({
    page,
    request,
  }) => {
    // layout.tsx owns `metadata.icons` outright (declaring the key at all
    // suppresses the App Router convention links). Three properties matter and
    // none is visible from a unit test, because all are about what Next
    // actually SERIALISES:
    //
    //   1. BOTH apple links carry a query, and the two queries are
    //      COMPLEMENTARY, so a UA that does honour `media` has exactly one
    //      eligible link per scheme. iOS is not such a UA — measured on device
    //      2026-08-12, `media` selects `apple-touch-startup-image` but NOT
    //      icons — but the queries cost nothing and keep the pair correct for
    //      any reader that does evaluate them.
    //   2. ORDER. Apple's rule for several same-size apple-touch-icon links is
    //      "last one wins", and that is the rule iOS actually applies. The DARK
    //      tile must therefore come last: it is the one colorway legible under
    //      every appearance, because iOS's auto-darkening is a no-op on artwork
    //      that is already dark. With the LIGHT tile last (the previous order)
    //      every no-JS capture took the Laser plate and iOS darkened its Void
    //      mark into an invisible emboss — the reported bug. Flip this array
    //      back and that returns.
    //   3. The hrefs resolve. These moved out of `src/app/` when the
    //      convention files were deleted; a stale path is a 404 in the
    //      Add-to-Home-Screen sheet, which fails silently.
    //
    // The third, appearance-MATCHED link that <AppleTouchIcon /> appends is
    // asserted separately below; this test is about the static floor beneath
    // it, so it reads the SSR'd markup rather than the hydrated head.
    const html = await (await request.get("/sign-in")).text();
    const staticApple = [...html.matchAll(/<link[^>]*rel="apple-touch-icon"[^>]*>/g)].map(
      (m) => m[0],
    );
    expect(staticApple).toHaveLength(2);
    expect(staticApple[0]).toContain("/icons/apple-touch-icon.png");
    expect(staticApple[0]).toContain("(prefers-color-scheme: light)");
    expect(
      staticApple[1],
      "the dark tile must be declared LAST — it is what iOS's last-one-wins resolves to",
    ).toContain("/icons/apple-touch-icon-dark.png");
    expect(staticApple[1]).toContain("(prefers-color-scheme: dark)");

    await page.goto("/sign-in");
    const readLinks = () =>
      page.evaluate(() =>
        Array.from(document.head.querySelectorAll<HTMLLinkElement>("link[rel]")).map(
          (l) => ({
            rel: l.rel,
            href: l.getAttribute("href"),
            media: l.media,
            ours: l.hasAttribute("data-appearance-matched"),
          }),
        ),
      );

    // Two static + the one <AppleTouchIcon /> appends, which must be LAST so
    // "last one wins" resolves to the appearance-matched tile rather than to
    // the static floor beneath it. Polled — the third arrives with hydration.
    await expect
      .poll(async () => (await readLinks()).filter((l) => l.rel === "apple-touch-icon").length)
      .toBe(3);

    const links = await readLinks();
    const apple = links.filter((l) => l.rel === "apple-touch-icon");
    expect(apple.at(-1)!.ours).toBe(true);

    // Scalable favicon first, raster fallbacks after.
    const icons = links.filter((l) => l.rel === "icon");
    expect(icons[0]!.href).toBe("/icons/favicon.svg");
    expect(icons.map((i) => i.href)).toContain("/icons/favicon-32.png");

    // The deleted convention files must not be referenced by anything.
    for (const dead of ["/icon0.svg", "/icon1.png", "/apple-icon.png"]) {
      expect(links.some((l) => l.href?.startsWith(dead))).toBe(false);
    }

    for (const href of [...apple.map((a) => a.href), ...icons.map((i) => i.href)]) {
      expect((await request.get(href!)).status(), `${href} is a 404`).toBe(200);
    }
  });

  test("the home-screen tile follows the live appearance", async ({ page }) => {
    // The mechanism iOS actually reads. It resolves `apple-touch-icon` from the
    // head at "Add to Home Screen" and takes the LAST one — so the tile a user
    // captures is whatever is last in the head at that moment. Keeping that
    // link matched to `prefers-color-scheme` is what makes an install in light
    // mode capture the Laser plate and an install in dark mode capture the
    // inverse. `media` cannot do this: measured on device 2026-08-12, iOS does
    // not evaluate it on icons (only on apple-touch-startup-image).
    //
    // Asserted WITHOUT a reload, because the appearance can change while the
    // page is open and the next capture must already be correct.
    const matched = () =>
      page.evaluate(() => {
        const links = document.head.querySelectorAll<HTMLLinkElement>(
          'link[rel="apple-touch-icon"]',
        );
        const last = links[links.length - 1];
        return {
          href: last?.getAttribute("href"),
          isOurs: last?.hasAttribute("data-appearance-matched"),
        };
      });

    // Polled, not read once: the link is appended by an effect, so a bare read
    // straight after goto() races hydration and sees the static floor instead.
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/sign-in");
    await expect
      .poll(matched, { message: "the matched tile never took over the head" })
      .toEqual({ href: "/icons/apple-touch-icon.png", isOurs: true });

    await page.emulateMedia({ colorScheme: "dark" });
    await expect
      .poll(matched, { message: "a scheme change must re-point the tile, and keep it last" })
      .toEqual({ href: "/icons/apple-touch-icon-dark.png", isOurs: true });

    await page.emulateMedia({ colorScheme: "light" });
    await expect
      .poll(matched, { message: "and back again" })
      .toEqual({ href: "/icons/apple-touch-icon.png", isOurs: true });
  });

  test("shares a square og:image and keeps the landscape card for X", async ({
    page,
    request,
  }) => {
    // Everything that reads og:image except X crops it toward a square — iOS
    // Safari's Share Sheet takes the centre 640×640 — so og:image is the
    // 1200×1200 brand tile and only `twitter:image` keeps the 2:1 card.
    // Asserting the DIMENSIONS, not just the paths: a landscape file put back
    // behind the og name would restore the crop bug while every path assertion
    // stayed green.
    await page.goto("/sign-in");
    const meta = await page.evaluate(() =>
      Object.fromEntries(
        Array.from(document.head.querySelectorAll<HTMLMetaElement>("meta")).map((m) => [
          m.getAttribute("property") ?? m.name,
          m.content,
        ]),
      ),
    );
    expect(meta["og:image"]).toMatch(/\/brand\/og-tile\.png$/);
    expect(meta["og:image:width"]).toBe(meta["og:image:height"]);
    expect(meta["twitter:image"]).toMatch(/\/brand\/social-card\.png$/);

    for (const src of ["/brand/og-tile.png", "/brand/social-card.png"]) {
      expect((await request.get(src)).status(), `${src} is a 404`).toBe(200);
    }
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
        Number(
          /\/\s*([\d.]+)\s*\)/.exec(v)?.[1] ?? /,\s*([\d.]+)\s*\)$/.exec(v)?.[1] ?? 1,
        );
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

  test("glass keeps its appearance while the page is moving", async ({ page }) => {
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
    // Both tokens: dropping either from the config must fail here (SW-006 —
    // the old no-cache-only assertion let a no-store regression ship green).
    expect(res.headers()["cache-control"]).toContain("no-cache");
    expect(res.headers()["cache-control"]).toContain("no-store");
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
    await expect(page.getByRole("heading", { name: "VIZION" })).toBeVisible();
    await expect(page.locator("body")).toContainText(/offline/i);
    await context.setOffline(false);
  });
});

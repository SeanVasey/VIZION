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

  test("the icon head pins ONE home-screen tile, unconditionally — the outlined one", async ({
    page,
    request,
  }) => {
    // layout.tsx owns `metadata.icons` outright (declaring the key at all
    // suppresses the App Router convention links). Three properties matter and
    // none is visible from a unit test, because all are about what Next
    // actually SERIALISES:
    //
    //   1. EXACTLY ONE apple link. iOS resolves this at "Add to Home Screen",
    //      freezes it, and auto-darkens the frozen tile under dark appearance
    //      (measured — docs/runbooks/ios-verification.md). Three arrangements
    //      that tried to make the tile FOLLOW the appearance — a complementary
    //      `media` pair, that pair reordered, and a JS matcher — all shipped an
    //      invisible mark, and one link is what stays (ADR-0015). What ADR-0017
    //      changed is the ARTWORK behind the link: the outlined tile is legible
    //      on either ground, so it no longer has to be the dark colorway.
    //   2. NO `media` on it. iOS does not evaluate `media` on icons (it does on
    //      apple-touch-startup-image, which is why the splash links resolve per
    //      device). A query here would imply a selection that never happens.
    //   3. The hrefs resolve. These moved out of `src/app/` when the
    //      convention files were deleted; a stale path is a 404 in the
    //      Add-to-Home-Screen sheet, which fails silently.
    const html = await (await request.get("/sign-in")).text();
    const staticApple = [...html.matchAll(/<link[^>]*rel="apple-touch-icon"[^>]*>/g)].map(
      (m) => m[0],
    );
    expect(staticApple).toHaveLength(1);
    expect(staticApple[0]).toContain("/icons/apple-touch-icon.png");
    expect(staticApple[0]).toContain('sizes="180x180"');
    expect(
      staticApple[0],
      "a query here implies a selection iOS never makes — see the metadata comment",
    ).not.toContain("media=");

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

    // Gate on a client effect having run before asserting the count. ThemeManager
    // creates this tag on the client — layout.tsx hand-writes only -capable and
    // -title — so its presence proves hydration is done. Without the gate,
    // "there is exactly one tile" would pass by racing hydration and could never
    // catch an appender being added back.
    await page.waitForFunction(
      () =>
        !!document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]'),
    );

    const links = await readLinks();
    const apple = links.filter((l) => l.rel === "apple-touch-icon");
    expect(apple).toHaveLength(1);
    expect(apple[0]!.href).toBe("/icons/apple-touch-icon.png");
    expect(
      links.some((l) => l.ours),
      "nothing appends an appearance-matched tile any more",
    ).toBe(false);

    // Scalable favicon first, raster fallbacks after.
    const icons = links.filter((l) => l.rel === "icon");
    expect(icons[0]!.href).toBe("/icons/app-icon.svg");
    expect(icons.map((i) => i.href)).toContain("/icons/favicon-32.png");

    // The deleted convention files — and the retired dark tile — must not be
    // referenced by anything.
    for (const dead of [
      "/icon0.svg",
      "/icon1.png",
      "/apple-icon.png",
      "/icons/apple-touch-icon-dark.png",
    ]) {
      expect(links.some((l) => l.href?.startsWith(dead))).toBe(false);
    }

    for (const href of [...apple.map((a) => a.href), ...icons.map((i) => i.href)]) {
      expect((await request.get(href!)).status(), `${href} is a 404`).toBe(200);
    }
  });

  test("the app icon is one outlined colorway, and does not move with the appearance", async ({
    page,
  }) => {
    // The requirement, stated as pixels (ADR-0017): a Laser plate, the mark
    // FILLED in Laser and STROKED in Void — both carriers present, so the mark
    // reads whether an OS keeps the plate or darkens it. And the SAME pixels
    // under both schemes: the `prefers-color-scheme` swap this file used to
    // carry is gone, and a renderer's scheme must not change what it paints.
    //
    // Runs on BOTH engines. The inversion test that stood here was scoped to
    // Chromium because WebKit does not apply `prefers-color-scheme` inside an
    // <img>-embedded SVG (measured — docs/runbooks/ios-verification.md); with
    // no media query left in the file there is nothing for the engines to
    // disagree about, and a WebKit render is worth having for the same reason
    // it was worth scoping out before: it is the engine the tile is for.
    //
    // RENDERED, not read: asserting the gradient and stroke are in the markup
    // would pass on an SVG whose paint never applies (a broken url(#ref), a
    // renderer that drops the stroke). These are the painted pixels, sampled
    // through an <img> because that is how an icon consumer embeds it.
    const sample = async (scheme: "light" | "dark") => {
      await page.emulateMedia({ colorScheme: scheme });
      const svg = await (await page.request.get("/icons/app-icon.svg")).text();
      const uri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
      await page.setContent(
        `<body style="margin:0"><img id="i" src="${uri}" width="400" height="400"></body>`,
      );
      // Decoded in-page rather than with an image library: the e2e project has
      // no raster dependency, and a canvas read-back is the same pixels.
      // (8,8) is plate; (200,151) sits inside the mark's vertical bar at this
      // 400px render; and the row y=151 from the left edge to the bar crosses
      // the bar's outline, so the darkest pixel on it is the stroke.
      return page.evaluate(async (dataUri: string) => {
        const img = new Image();
        img.src = dataUri;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = 400;
        c.height = 400;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0, 400, 400);
        const px = (x: number, y: number) => {
          const d = ctx.getImageData(x, y, 1, 1).data;
          return { r: d[0]!, g: d[1]!, b: d[2]! };
        };
        const luma = (p: { r: number; g: number; b: number }) =>
          0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b;
        let darkest = 255;
        for (let x = 0; x <= 200; x++) darkest = Math.min(darkest, luma(px(x, 151)));
        return { plate: px(8, 8), mark: px(200, 151), darkest };
      }, uri);
    };

    const light = await sample("light");
    const dark = await sample("dark");

    // One colorway: the scheme changes nothing.
    expect(dark, "the icon must not move with the appearance").toEqual(light);

    // Both carriers, in channel order rather than hexes (tokens.css owns the
    // hexes; the generator derives the ramp from them).
    const greenLed = (p: { r: number; g: number; b: number }, what: string) => {
      expect(p.g, `${what}: green leads`).toBeGreaterThan(p.r);
      expect(p.r, `${what}: red leads blue — a lime, not a teal`).toBeGreaterThan(p.b);
      expect(p.g, `${what}: strong green`).toBeGreaterThan(200);
    };
    greenLed(light.plate, "plate");
    greenLed(light.mark, "mark fill");
    expect(
      light.darkest,
      "the Void outline is painted (luma of --void is ~16)",
    ).toBeLessThan(48);
  });

  test("the home-screen tile does NOT move with the appearance", async ({ page }) => {
    // This used to assert that the tile TRACKED `prefers-color-scheme`, so an
    // install made in light mode captured the Laser plate. A device pass killed
    // that: iOS freezes the tile at "Add to Home Screen" and auto-darkens the
    // frozen copy under dark appearance, so matching could only ever choose
    // WHICH capture a user got, never avoid the darkening. Invariance is the
    // fix — one tile (ADR-0015), now the outlined one that is legible under
    // either treatment (ADR-0017).
    //
    // Checked WITHOUT a reload: an appearance change while the page is open must
    // not move the tile, because whatever is in the head is what the next capture
    // freezes.
    const tiles = () =>
      page.evaluate(() =>
        Array.from(
          document.head.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"]'),
        ).map((l) => l.getAttribute("href")),
      );

    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/sign-in");
    // Hydration gate — see the head test above for why a bare read is not enough.
    await page.waitForFunction(
      () =>
        !!document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]'),
    );

    for (const scheme of ["light", "dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      expect(await tiles(), `the tile moved under ${scheme}`).toEqual([
        "/icons/apple-touch-icon.png",
      ]);
    }
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

  test("the manifest link carries credentials, so a protected preview can read it", async ({
    page,
    request,
  }) => {
    // The Web App Manifest spec fetches the manifest with credentials OMITTED
    // unless the link says `crossorigin="use-credentials"` — even same-origin
    // cookies stay home. Vercel's preview Deployment Protection is a cookie, so
    // without the attribute every preview served the page and answered the
    // manifest fetch with a 302 to Vercel's SSO page (measured 2026-09-04), so
    // the install flow lost the app's NAME (the Home Screen sheet
    // fell back to the page title, route first), its icons and its display
    // mode. There must be exactly ONE manifest link (a browser reads only the
    // first), it must be the credentialed one, and it must be in the SSR head —
    // Safari reads it at "Add to Home Screen" from the document as served.
    const html = await (await request.get("/sign-in")).text();
    const head = html.slice(0, html.indexOf("</head>"));
    const links = [...head.matchAll(/<link[^>]*rel="manifest"[^>]*>/g)].map((m) => m[0]);
    expect(links, "exactly one manifest link, in <head>").toHaveLength(1);
    expect(links[0]).toContain('href="/manifest.webmanifest"');
    expect(links[0]).toContain('crossorigin="use-credentials"');

    // ...and React must not add a second, attribute-less one on hydration
    // (which `metadata.manifest` would).
    await page.goto("/sign-in");
    await page.waitForFunction(
      () =>
        !!document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]'),
    );
    const live = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="manifest"]')).map(
        (l) => ({ href: l.getAttribute("href"), crossOrigin: l.crossOrigin }),
      ),
    );
    expect(live).toEqual([
      { href: "/manifest.webmanifest", crossOrigin: "use-credentials" },
    ]);

    // The Home Screen name sources all agree — the manifest is what a modern
    // install reads, the meta is the legacy channel, and the tab title is the
    // last fallback; none of them may say anything but the app's name first
    // except the tab, whose template is page-first by design.
    const name = await page.evaluate(() => ({
      meta: document.querySelector<HTMLMetaElement>(
        'meta[name="apple-mobile-web-app-title"]',
      )?.content,
      appName: document.querySelector<HTMLMetaElement>('meta[name="application-name"]')
        ?.content,
    }));
    expect(name).toEqual({ meta: "VIZION", appName: "VIZION" });
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest.name).toBe("VIZION");
    expect(manifest.short_name).toBe("VIZION");
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

import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { signIn, expectNoUnhandledStubRoutes } from "./support/auth";

/**
 * The app behind the auth gate.
 *
 * Everything here was previously unreachable from e2e: middleware bounces an
 * unauthenticated request to `/sign-in`, so the whole product — nav, library,
 * settings, every `loading.tsx` — had no end-to-end coverage, and specs that
 * wanted it synthesised markup and asserted against the stylesheet instead.
 * These drive the real thing. See `support/supabase-stub.mjs`.
 */
test.describe("authenticated app", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("lands on Enhance with the primary nav", async ({ page }) => {
    await expect(page).toHaveURL(/\/enhance$/);
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: "Enhance" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.getByRole("link", { name: "Library" })).toHaveCount(1);
    await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(1);
  });

  test("the brand mark is optically centred on the wordmark", async ({ page }) => {
    // `align-items: center` centres the h1's LINE BOX, whose centre sits at
    // `baseline − (ascent − descent) / 2` — not at the CAP BAND centre the eye
    // actually reads the word as. For Bebas Neue those disagree, and the mark
    // hung low: 0.99px of clearance above the cap line against 2.98px below the
    // baseline (Chromium; 0.38 / 3.79 in WebKit). ScreenHeader's −0.046em lift
    // closes that, and this is the measurement that keeps it closed.
    //
    // PIXELS, not font metrics. The two engines' canvas `actualBoundingBox`
    // values for this face disagree by 12%, and the layout ascent/descent they
    // use is not the pair canvas reports — deriving the baseline arithmetically
    // gave an answer 1.3px away from where the glyphs actually landed. What is
    // on screen is the only thing that settles it.
    //
    // Tolerance: a revert measures 1.99px (Chromium) / 3.41px (WebKit) of
    // imbalance and the fix measures 0.76 / 0.66, so ±1.25px separates them with
    // room for the ±1 image-row quantisation at dpr 2.6–3 (~0.35px a side).
    // Settle the streamed handover first. `/enhance/loading.tsx` renders the
    // same branded header as the page, and under a loaded suite both were
    // briefly in the DOM — two identical lockups, which is a strict-mode
    // violation rather than a real failure. Waiting for the count to fall back
    // to one is the wait; the h1 is then read off the ROW, not the document, so
    // mark and word can never be sampled from different headers.
    const mark = page.locator('header svg[viewBox="0 0 1024 892.8"]');
    await expect(mark).toHaveCount(1);
    const row = mark.locator("xpath=..");
    const heading = row.locator("h1");
    await expect(mark).toBeVisible();

    // Flatten the chrome to pure black-on-white so a luminance threshold is
    // unambiguous. Colour only — nothing here moves a box.
    await page.addStyleTag({
      content: `header.glass-chrome::before { display: none !important; }
                header.glass-chrome { background: #000 !important; }
                header * { color: #fff !important; }`,
    });

    const [rowBox, markBox, headingBox] = await Promise.all([
      row.boundingBox(),
      mark.boundingBox(),
      heading.boundingBox(),
    ]);
    const shot = await row.screenshot();
    const { data, info } = await sharp(shot)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // Derive the capture scale rather than assuming devicePixelRatio.
    const scale = info.width / rowBox!.width;

    /** [top, bottom] of the inked rows in a CSS-px column slice, in CSS px. */
    const inkBand = (fromX: number, toX: number): [number, number] => {
      const x0 = Math.max(0, Math.round((fromX - rowBox!.x) * scale));
      const x1 = Math.min(info.width, Math.round((toX - rowBox!.x) * scale));
      let top = -1;
      let bottom = -1;
      for (let y = 0; y < info.height; y++) {
        let lit = 0;
        for (let x = x0; x < x1; x++) if (data[y * info.width + x]! > 127) lit++;
        if (lit > 0) {
          if (top < 0) top = y;
          bottom = y;
        }
      }
      expect(top, "no ink found in the slice").toBeGreaterThanOrEqual(0);
      return [top / scale, (bottom + 1) / scale];
    };

    const [markTop, markBottom] = inkBand(markBox!.x, markBox!.x + markBox!.width);
    const [wordTop, wordBottom] = inkBand(
      headingBox!.x,
      headingBox!.x + headingBox!.width,
    );

    // The mark is taller than the caps by design, so it clears the word both
    // ways; what must not happen is clearing one way much more than the other.
    const above = wordTop - markTop;
    const below = markBottom - wordBottom;
    expect(above, "the mark should overhang the cap line").toBeGreaterThan(0);
    expect(below, "the mark should overhang the baseline").toBeGreaterThan(0);
    expect(
      Math.abs(above - below),
      `mark overhangs the word by ${above.toFixed(2)}px above and ${below.toFixed(2)}px below`,
    ).toBeLessThanOrEqual(1.25);
  });

  test("a real nav tab acknowledges a press", async ({ page }) => {
    // The reason this file exists. The press affordance previously could only
    // be checked against a hand-written `<a class="pressable nav-tab">` probe,
    // because the bar is behind auth — and that probe drifted from the real
    // component while every test stayed green (the nav shipped with no scale
    // at all). This asserts the shipped element.
    const library = page.getByRole("navigation").getByRole("link", { name: "Library" });
    const box = (await library.boundingBox())!;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(library).toHaveAttribute("data-pressed", "true");
    const pressed = await library.evaluate((el) => getComputedStyle(el).transform);
    await page.mouse.up();

    expect(pressed).not.toBe("none");
    // scale(0.9) — the matrix's first component.
    expect(Number(pressed.match(/matrix\(([-\d.]+)/)![1])).toBeCloseTo(0.9, 2);

    // And it releases (after the 130ms minimum hold).
    await expect(library).not.toHaveAttribute("data-pressed", "true", {
      timeout: 2000,
    });
  });

  test("navigates between tabs and moves aria-current", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Primary" });

    await nav.getByRole("link", { name: "Library" }).click();
    await page.waitForURL(/\/library/);
    await expect(nav.getByRole("link", { name: "Library" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.getByRole("link", { name: "Enhance" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );

    await nav.getByRole("link", { name: "Settings" }).click();
    await page.waitForURL(/\/profile/);
    await expect(nav.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("renders the library from the server, with content-visibility rows", async ({
    page,
  }) => {
    await page.getByRole("navigation").getByRole("link", { name: "Library" }).click();
    await page.waitForURL(/\/library/);

    // Scoped to the list rows, not the page: the titles also appear in the
    // activity feed and in the swipe actions' screen-reader labels.
    const rows = page.locator("li.scroll-row");
    await expect(rows).toHaveCount(3);
    // Ordering is the server's `updated_at desc`, not insertion order — the
    // fixture gives each row a distinct timestamp so this means something.
    await expect(rows.nth(0)).toContainText("E2E prompt 1");
    await expect(rows.nth(1)).toContainText("E2E prompt 2");
    await expect(rows.nth(2)).toContainText("E2E prompt 3");

    // `.scroll-row` is what stops scroll cost scaling with library size. Only a
    // real engine can say whether the declaration actually applies.
    expect(
      await rows.first().evaluate((el) => getComputedStyle(el).contentVisibility),
    ).toBe("auto");

    await expectNoUnhandledStubRoutes();
  });

  test("glass cards hold their appearance while an authed page is scrolling", async ({
    page,
  }) => {
    // The reported defect (2026-08): every library/settings panel visibly
    // shifted grey the moment a flick started, because the scroll gate
    // restyled `.glass`. The signed-out spec asserts this on a form input;
    // this one runs it over a real library card — the panel-dense case where
    // the shift was reported — and must compute the SAME fill and blur
    // mid-scroll as at rest.
    await page.getByRole("navigation").getByRole("link", { name: "Library" }).click();
    await page.waitForURL(/\/library/);

    const card = page.locator("li.scroll-row a.glass").first();
    const atRest = await card.evaluate((el) => {
      const s = getComputedStyle(el);
      return { blur: s.backdropFilter, fill: s.backgroundColor };
    });
    expect(atRest.blur).toContain("blur");

    await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
    await expect(page.locator("html")).toHaveAttribute("data-scrolling", "");
    expect(
      await card.evaluate((el) => {
        const s = getComputedStyle(el);
        return { blur: s.backdropFilter, fill: s.backgroundColor };
      }),
    ).toEqual(atRest);

    await expect(page.locator("html")).not.toHaveAttribute("data-scrolling", "");
  });

  test("reserves nav clearance so content is never trapped under the bar", async ({
    page,
  }) => {
    // `--bottom-nav-h` is the single source of truth for both the bar's height
    // and the scroll region's reservation; the two drifting apart is what
    // strands content under the nav.
    const reserved = await page.evaluate(() => {
      const main = document.querySelector("main")!;
      return parseFloat(getComputedStyle(main).paddingBottom);
    });
    const navHeight = (await page
      .getByRole("navigation", { name: "Primary" })
      .boundingBox())!.height;
    expect(reserved).toBeGreaterThanOrEqual(navHeight);
  });

  test("reduced effects actually silences the Horizon breathe", async ({ page }) => {
    // Pinned in a real browser because the failure mode is a SPECIFICITY win,
    // not a missing rule: the breathe hangs off
    // `.horizon[data-state="idle"] .horizon-node` (0,3,0), so a gate written as
    // `[data-reduced-effects] .horizon-node` (0,2,0) parses fine, reads fine,
    // and loses. The unit test that only greps globals.css for the gate's text
    // stayed green while the toggle did nothing.
    // Polled, not read once. `toggleAttribute` followed by an immediate
    // getComputedStyle is a race: under parallel load WebKit had not always
    // recomputed style by the time the next evaluate ran, which failed this
    // test in ~2 of 3 full-suite runs while passing 3 of 3 in isolation.
    // Polling keeps the assertion's meaning exactly — a gate that genuinely
    // loses on specificity never becomes "none", so it still fails — and only
    // stops the timing from deciding the outcome.
    const animationName = () =>
      page.evaluate(
        () => getComputedStyle(document.querySelector(".horizon-node")!).animationName,
      );

    await expect.poll(animationName).toBe("horizon-breathe");

    await page.evaluate(() =>
      document.documentElement.toggleAttribute("data-reduced-effects", true),
    );
    await expect.poll(animationName).toBe("none");
  });

  test("the Horizon band trims its dead air without shrinking the mark", async ({
    page,
  }) => {
    // The band's height IS its padding — the mark inside is a 1px rule and a
    // 5px node at every size. It inherited the replaced emblem's
    // min(width / 5, 64px), which was sized for an SVG lockup and left ~1.5x
    // too much air once the lockup was a hairline; 28px is the trim.
    //
    // Both halves matter and they fail differently: shrinking the band is the
    // fix, shrinking the rule or the node is the thing that was explicitly
    // asked NOT to happen, and a height regression that scaled everything down
    // together would satisfy either assertion alone. Two widths because the old
    // height tracked viewport width — a flat number has to be checked flat.
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 860 });
      expect((await page.locator(".horizon").boundingBox())!.height).toBeCloseTo(28, 1);
      expect((await page.locator(".horizon-rule").boundingBox())!.height).toBeCloseTo(
        1,
        1,
      );
      // getComputedStyle, not boundingBox: the node is mid-breathe and
      // getBoundingClientRect() reports the SCALED box (up to 7.5px).
      const node = await page.locator(".horizon-node").evaluate((el) => ({
        width: getComputedStyle(el).width,
        height: getComputedStyle(el).height,
      }));
      expect(node, `node at ${width}px`).toEqual({ width: "5px", height: "5px" });
    }
  });

  test("every mode label stays on one line from 320 to 430px", async ({ page }) => {
    // CMC-06/VAR-01 fixed the mode-rail labels and recorded "all six fit at
    // 320" — but the label steps UP 10px→11px at ≥360px, and at 11px with
    // tracking-wide "Condense" wrapped to two lines at 393px (the default
    // iPhone width) — a fit claim proven only on the branch it measured. This
    // pins the WHOLE range: no label may wrap at any supported width. Detection
    // is relative and font-agnostic — a wrapped label is ~2× the single-line
    // height of its unwrapped siblings, so the tallest must stay near the
    // shortest. (The `overflow-wrap:anywhere` text-scale valve is untouched;
    // this only asserts the DEFAULT type never needs it.)
    const labels = page
      .getByRole("radiogroup", { name: "Enhancement mode" })
      .locator('[role="radio"] span');
    await expect(labels).toHaveCount(6);
    for (const width of [320, 360, 390, 430]) {
      await page.setViewportSize({ width, height: 860 });
      const heights = await labels.evaluateAll((els) =>
        els.map((e) => Math.round(e.getBoundingClientRect().height)),
      );
      const min = Math.min(...heights);
      const max = Math.max(...heights);
      expect(
        max,
        `a mode label wraps at ${width}px — heights ${heights.join(",")}`,
      ).toBeLessThan(min * 1.6);
    }
  });

  test("settings renders the signed-in identity", async ({ page }) => {
    await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
    await page.waitForURL(/\/profile/);
    await expect(page.getByText("e2e@vasey.test")).toBeVisible();
    await expectNoUnhandledStubRoutes();
  });
});

/**
 * The floating "New prompt" button and the Drafts view it feeds.
 *
 * Driven through the real app because the parts that can break are not in the
 * component: the button is fixed chrome that has to clear the bottom nav, the
 * save path crosses a server action into PostgREST, and the Drafts view is a
 * different relation reached through the same URL filter grammar.
 */
test.describe("new prompt + drafts", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("is on Library and Settings, absent on the composer", async ({ page }) => {
    const fab = page.getByRole("button", { name: "New prompt" });
    // /enhance already owns this action through the composer's own Clear.
    await expect(page).toHaveURL(/\/enhance$/);
    await expect(fab).toHaveCount(0);

    await page.getByRole("navigation").getByRole("link", { name: "Library" }).click();
    await page.waitForURL(/\/library$/);
    await expect(fab).toBeVisible();

    await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
    await page.waitForURL(/\/profile$/);
    await expect(fab).toBeVisible();
  });

  test("clears the bottom nav and keeps a 44px target", async ({ page }) => {
    await page.goto("/library");
    const fab = page.getByRole("button", { name: "New prompt" });
    const box = (await fab.boundingBox())!;
    const nav = (await page.getByRole("navigation").boundingBox())!;

    // Trapped under the nav would make it unreachable — the whole point of
    // pinning it to --bottom-nav-h rather than a hardcoded offset.
    expect(box.y + box.height).toBeLessThanOrEqual(nav.y + 1);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });

  test("goes straight to an empty composer when there is no draft", async ({ page }) => {
    await page.goto("/library");
    await page.getByRole("button", { name: "New prompt" }).click();
    await page.waitForURL(/\/enhance$/);
    await expect(page.locator("#prompt-input")).toHaveValue("");
  });

  /*
   * NOT covered here: the full save → list → resume journey.
   *
   * It needs a draft to exist before the button is pressed, and every way of
   * arranging that proved unreliable on this container when both browser
   * projects run at once. Typing loses a race with hydration against the
   * CONTROLLED textarea (20s of retried fills never stuck in WebKit-under-load,
   * while WebKit alone passed every time); seeding the persisted store key and
   * reloading failed in both engines. Reaching the Drafts view is its own
   * hazard: `sw-src.js` answers navigations itself (StaleWhileRevalidate, with
   * setCatchHandler falling back to the precached /enhance shell), so a hard
   * `page.goto` is served by the service worker — in WebKit it returned that
   * shell instead of the Drafts page, and a repeat visit to one URL was served
   * stale, which reads as "the delete did not happen" when the row was already
   * gone from the database.
   *
   * A test that is green in one project and red in the other is worse than an
   * absent one, so that journey is covered where it is deterministic:
   * `tests/unit/new-prompt-fab.test.tsx` (save/discard/undo/cancel and the
   * keep-the-draft-on-failure rule) and `tests/unit/drafts-list.test.tsx`
   * (resume restores the whole composer state and drops the server copy).
   * What remains here is what only a real engine can answer — where the button
   * is, that it clears the nav, and that it is on the right routes.
   */
});

/**
 * The thinking rail's hold-slider (ADR-0012), driven with a real mouse —
 * which is exactly why the gesture includes mouse pointers at all. Only an
 * engine can answer whether the hold timer, pointer capture, and the
 * trailing-click suppression compose over a real event stream. This is
 * evidence about the RENDERING ENGINE only: the iOS half (callout
 * suppression, mid-drag pointercancel) is on the manual list in
 * docs/runbooks/ios-verification.md.
 */
test.describe("thinking hold-slider", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("press-hold-drag commits a depth; a plain click still opens the sheet", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /^Thinking depth:/ });
    await expect(pill).toContainText("Auto");
    const box = (await pill.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // A `.sheet-in` probe, appended before the press — the twentieth-pass
    // scenario is a toast still rising as the gesture engages.
    await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.setAttribute("data-e2e-sheet-in-probe", "");
      probe.className = "sheet-in";
      document.body.appendChild(probe);
    });

    // Hold past HOLD_MS (300ms), then drag three detents right:
    // Auto → Low → Medium → High.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await expect(page.locator("[data-hold-slider-overlay]")).toBeVisible();
    // The focus pair rides the gesture: up with the capsule, gone on release.
    await expect(page.locator("[data-hold-slider-scrim]")).toBeVisible();
    await expect(page.locator("[data-hold-slider-blur]")).toBeVisible();
    // So does the thumb — the moving object the reference control carries.
    await expect(page.locator("[data-hold-slider-thumb]")).toBeVisible();
    // The thinking capsule wears rising bars (the DepthGlyph vocabulary),
    // six for Opus's ladder — the budget capsule keeps equal dots.
    await expect(
      page.locator("[data-hold-slider-overlay] [data-detent-bar]"),
    ).toHaveCount(6);
    // The world pauses under the gesture: every idle ornament beneath the
    // blur holds its frame — the Horizon's breathe included, not only the
    // nebula blooms — so the filtered backdrop is genuinely static. A real
    // browser, deliberately: the breathe's shorthand at (0,3,0) resets
    // play-state, so an under-specified pause rule parses and silently
    // loses (the reduced-effects test above pins the same trap). Polled,
    // not read once — style recompute lags the attribute under load.
    const horizonPlayState = () =>
      page
        .locator(".horizon-node")
        .evaluate((el) => getComputedStyle(el).animationPlayState);
    await expect.poll(horizonPlayState).toBe("paused");
    // One-shot entrances count too (eighteenth pass: the footer's delayed
    // rise animated beneath the blur when a gesture engaged inside its
    // first 1.6s) — the computed play-state reflects the declaration
    // whether or not the animation is mid-flight, so this pins the rule.
    const footerPlayState = () =>
      page
        .locator(".footer-fade-in")
        .evaluate((el) => getComputedStyle(el).animationPlayState);
    await expect.poll(footerPlayState).toBe("paused");
    // And the SHARED `.sheet-in` entrance (twentieth pass): toasts and the
    // diff toolbar wear it with no role="dialog" for the probe, so a toast
    // mid-rise as the slide engages kept recompositing the blurred
    // backdrop. The probe node stands in for a toast: the class is the
    // mechanism, and this pins its cascade in a real engine.
    const sheetInPlayState = () =>
      page
        .locator("[data-e2e-sheet-in-probe]")
        .evaluate((el) => getComputedStyle(el).animationPlayState);
    await expect.poll(sheetInPlayState).toBe("paused");
    // TRANSITIONS are inventory too (twenty-first pass): the pill's own
    // conceal fade ran beneath the just-mounted blur, re-filtering every
    // frame of var(--motion-quick) at every motion-enabled activation —
    // the one transition on backdrop content the animation sweep never
    // saw. Under the gesture the conceal snaps (the reduced-motion
    // presentation); the fade-back on release keeps its motion, running
    // only after the blur is gone.
    const concealTransition = () =>
      page
        .locator(".hold-slider-conceal")
        .first()
        .evaluate((el) => getComputedStyle(el).transitionDuration);
    await expect.poll(concealTransition).toBe("0s");
    // The pair is also the gesture's input SHIELD: a second pointer cannot
    // reach any control while the capsule is up — the Target pill fails
    // Playwright's receives-events actionability check because the scrim
    // intercepts the point (real hit-testing, which jsdom cannot pin).
    await expect(
      page
        .getByRole("button", { name: /^Target model:/ })
        .click({ trial: true, timeout: 800 }),
    ).rejects.toThrow();
    await page.mouse.move(cx + 3 * 44, cy, { steps: 6 });
    await page.mouse.up();

    await expect(page.locator("[data-hold-slider-overlay]")).toHaveCount(0);
    await expect(page.locator("[data-hold-slider-scrim]")).toHaveCount(0);
    await expect(page.locator("[data-hold-slider-blur]")).toHaveCount(0);
    // …and thaws with the release, resuming where it stood.
    await expect.poll(horizonPlayState).toBe("running");
    await expect.poll(sheetInPlayState).toBe("running");
    await expect.poll(concealTransition).toBe("0.15s");
    await expect(pill).toContainText("High");
    // The trailing click was swallowed — no sheet.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The tap path is untouched: a plain click opens the sheet as before.
    await pill.click();
    const sheet = page.getByRole("dialog", { name: "Thinking depth" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("radio", { name: "High", exact: true })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("a press held inside the open sheet never grows the track", async ({ page }) => {
    // The sheet is a body portal but a React child of the gesture wrapper,
    // so its presses re-dispatch through the wrapper's handlers — pre-guard,
    // holding a row here drew the capsule across the open sheet and the
    // trailing-click suppression ate the row's own tap (2026-08-10).
    const pill = page.getByRole("button", { name: /^Thinking depth:/ });
    await pill.click();
    const sheet = page.getByRole("dialog", { name: "Thinking depth" });
    await expect(sheet).toBeVisible();
    const row = sheet.getByRole("radio", { name: "High", exact: true });
    const box = (await row.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Well past HOLD_MS — the honest wait for an absence.
    await page.waitForTimeout(400);
    await expect(page.locator("[data-hold-slider-overlay]")).toHaveCount(0);
    await page.mouse.up();
    // The row's own click landed: depth picked, sheet closed.
    await expect(sheet).toHaveCount(0);
    await expect(pill).toContainText("High");
  });

  test("the track expands in the same home for every press point", async ({ page }) => {
    // ADR-0012 amendment 4: fixed-home geometry — the capsule must land in
    // the identical spot whether the press began at the pill's left or
    // right edge. Releasing without travel re-commits the anchor (Auto), so
    // neither gesture changes state.
    const pill = page.getByRole("button", { name: /^Thinking depth:/ });
    const box = (await pill.boundingBox())!;
    const y = box.y + box.height / 2;
    const overlay = page.locator("[data-hold-slider-overlay]");

    await page.mouse.move(box.x + 8, y);
    await page.mouse.down();
    await expect(overlay).toBeVisible();
    const first = (await overlay.boundingBox())!;
    await page.mouse.up();
    await expect(overlay).toHaveCount(0);

    await page.mouse.move(box.x + box.width - 8, y);
    await page.mouse.down();
    await expect(overlay).toBeVisible();
    const second = (await overlay.boundingBox())!;
    await page.mouse.up();
    await expect(overlay).toHaveCount(0);

    expect(Math.abs(first.x - second.x)).toBeLessThan(1);
    expect(Math.abs(first.y - second.y)).toBeLessThan(1);
  });

  test("Escape mid-drag cannot leak the claim — the world lives on after the far-away lift", async ({
    page,
  }) => {
    // A real-engine pin on ROUTING, deliberately: mid-drag the pointer sits
    // over the track's center, far from the pill, and after Escape the lift
    // is only routed back to the hook by pointer CAPTURE. Pre-fix, teardown
    // released capture at Escape, the lift was hit-tested elsewhere and
    // never reached onPointerUp — the press record and the app-wide claim
    // leaked, so every hold-slider press (and every wrapped pill's click)
    // stayed dead until remount. jsdom cannot see any of this: it has no
    // capture routing, so the unit suite's lift always lands on the pill.
    const pill = page.getByRole("button", { name: /^Thinking depth:/ });
    const box = (await pill.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const overlay = page.locator("[data-hold-slider-overlay]");

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await expect(overlay).toBeVisible();
    // Drag off the pill toward the track's center, then revert.
    await page.mouse.move(cx - 150, cy, { steps: 4 });
    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);
    // The lift lands 150px from the pill — the captured stream must still
    // deliver it to the hook, where the press dies and the claim releases.
    await page.mouse.up();

    // Both halves of the control breathe again: a fresh hold engages…
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await expect(overlay).toBeVisible();
    await page.keyboard.press("Escape");
    await page.mouse.up();
    // …and the tap path still opens the sheet (the tenth pass's click
    // consumption must have let go with the claim).
    await pill.click();
    await expect(page.getByRole("dialog", { name: "Thinking depth" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(pill).toContainText("Auto");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("an edge press that escapes the wrapper cannot activate a phantom capsule", async ({
    page,
  }) => {
    // A mouse is not implicitly captured: press 2px inside the pill's
    // edge, jump out in ONE move (no intermediate point lands inside), and
    // release far away — the wrapper hears none of it. Pre-fix the hold
    // timer fired on the stale press: a phantom capsule, freeze, and input
    // shield with no pointer down, dead until remount. The window net now
    // hears the outside lift and clears the timer (twelfth pass).
    const pill = page.getByRole("button", { name: /^Thinking depth:/ });
    const box = (await pill.boundingBox())!;
    const cy = box.y + box.height / 2;
    await page.mouse.move(box.x + 2, cy);
    await page.mouse.down();
    await page.mouse.move(box.x - 200, cy);
    await page.mouse.up();
    // Past HOLD_MS — the honest wait for an absence.
    await page.waitForTimeout(400);
    await expect(page.locator("[data-hold-slider-overlay]")).toHaveCount(0);
    // Nothing leaked: a fresh hold on the same pill engages normally.
    await page.mouse.move(box.x + box.width / 2, cy);
    await page.mouse.down();
    await expect(page.locator("[data-hold-slider-overlay]")).toBeVisible();
    await page.mouse.up();
  });

  /**
   * The same control under REAL SYNTHESIZED TOUCH — Chromium only, because
   * touch synthesis rides CDP and WebKitGTK has no equivalent. This is the
   * layer the on-device failure lived in (2026-08-09): the mouse spec above
   * waits out the hold before moving, so the whole pre-hold window — where
   * the UA competes for the gesture and the slop rule classifies the press —
   * had no engine coverage at all. Chromium's gesture recognizer consults
   * `touch-action`, derives pointer events, and synthesizes the tap click
   * exactly where iOS does; it is still not iOS (the callout/loupe half
   * stays on the manual list in docs/runbooks/ios-verification.md).
   */
  test.describe("under touch", () => {
    const pillBox = async (page: import("@playwright/test").Page) => {
      const pill = page.getByRole("button", { name: /^Thinking depth:/ });
      await expect(pill).toContainText("Auto");
      const box = (await pill.boundingBox())!;
      return { pill, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
    };
    const touchSender = async (page: import("@playwright/test").Page) => {
      const cdp = await page.context().newCDPSession(page);
      return (
        type: "touchStart" | "touchMove" | "touchEnd",
        points: { x: number; y: number }[],
      ) =>
        cdp.send("Input.dispatchTouchEvent", {
          type,
          touchPoints: points.map((p) => ({ ...p, id: 1 })),
        });
    };

    test.beforeEach(({ browserName }) => {
      test.skip(browserName !== "chromium", "touch synthesis is CDP, Chromium-only");
    });

    test("press-and-slide in one unbroken motion engages and commits", async ({
      page,
    }) => {
      const { pill, cx, cy } = await pillBox(page);
      const touch = await touchSender(page);

      // The reference gesture (ADR-0012's ChatGPT recording): press and slide
      // sideways at once, never pausing for the hold timer. Six 22px steps =
      // three detents right: Auto → Low → Medium → High.
      await touch("touchStart", [{ x: cx, y: cy }]);
      for (let step = 1; step <= 6; step++) {
        await touch("touchMove", [{ x: cx + step * 22, y: cy }]);
        await page.waitForTimeout(20);
      }
      await expect(page.locator("[data-hold-slider-overlay]")).toBeVisible();
      await touch("touchEnd", []);

      await expect(page.locator("[data-hold-slider-overlay]")).toHaveCount(0);
      await expect(pill).toContainText("High");
      // The synthesized tap click after the lift must not open the sheet.
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });

    test("a stationary touch hold expands the track without opening the sheet", async ({
      page,
    }) => {
      const { pill, cx, cy } = await pillBox(page);
      const touch = await touchSender(page);

      await touch("touchStart", [{ x: cx, y: cy }]);
      // No movement at all: the 300ms timer is the only way in, and the UA
      // (long-press context menu, selection) must not wrestle it away.
      await expect(page.locator("[data-hold-slider-overlay]")).toBeVisible();
      await touch("touchEnd", []);

      await expect(page.locator("[data-hold-slider-overlay]")).toHaveCount(0);
      // Released on the anchor detent: Auto re-commits, nothing changes.
      await expect(pill).toContainText("Auto");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });

    test("a quick touch tap still opens the sheet", async ({ page }) => {
      const { cx, cy } = await pillBox(page);
      const touch = await touchSender(page);

      // Pipelined, NOT awaited in sequence: CDP commands process in order,
      // and awaiting the start's round-trip under a loaded worker pool once
      // stretched the "tap" past HOLD_MS — at which point the control
      // rightly treated it as a hold and suppressed the click. The finger
      // this simulates is down for milliseconds; the dispatch must be too.
      const start = touch("touchStart", [{ x: cx, y: cy }]);
      const end = touch("touchEnd", []);
      await Promise.all([start, end]);

      // The resting axis claim must not cost the synthesized click.
      await expect(page.getByRole("dialog", { name: "Thinking depth" })).toBeVisible();
      await expect(page.locator("[data-hold-slider-overlay]")).toHaveCount(0);
    });

    test("activation keys die under a live capsule — a focused control cannot open its sheet", async ({
      page,
    }) => {
      // Touch never moves keyboard focus, so a background trigger can stay
      // focused while a finger holds the pill — the hybrid pair the
      // pointer-events shield cannot see (keys are their own channel,
      // fourteenth pass). Pre-fix, Enter activated the focused template
      // button and its sheet opened under the live capsule.
      const template = page.getByRole("button", { name: /try a template/i });
      await template.focus();
      const { cx, cy } = await pillBox(page);
      const touch = await touchSender(page);

      await touch("touchStart", [{ x: cx, y: cy }]);
      await expect(page.locator("[data-hold-slider-overlay]")).toBeVisible();
      await page.keyboard.press("Enter");
      await page.keyboard.press(" ");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await touch("touchEnd", []);
      await expect(page.locator("[data-hold-slider-overlay]")).toHaveCount(0);

      // At rest the keyboard is untouched. Refocus first — the UA may move
      // focus during a touch interaction, and that is its business; the
      // pin here is that the swallow ended with the gesture.
      await template.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog")).toBeVisible();
    });
  });
});

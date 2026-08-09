import { test, expect } from "@playwright/test";
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
      expect((await page.locator(".horizon").boundingBox())!.height).toBeCloseTo(
        28,
        1,
      );
      expect(
        (await page.locator(".horizon-rule").boundingBox())!.height,
      ).toBeCloseTo(1, 1);
      // getComputedStyle, not boundingBox: the node is mid-breathe and
      // getBoundingClientRect() reports the SCALED box (up to 7.5px).
      const node = await page.locator(".horizon-node").evaluate((el) => ({
        width: getComputedStyle(el).width,
        height: getComputedStyle(el).height,
      }));
      expect(node, `node at ${width}px`).toEqual({ width: "5px", height: "5px" });
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

    // Hold past HOLD_MS (300ms), then drag three detents right:
    // Auto → Low → Medium → High.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await expect(page.locator("[data-hold-slider-overlay]")).toBeVisible();
    await page.mouse.move(cx + 3 * 44, cy, { steps: 6 });
    await page.mouse.up();

    await expect(page.locator("[data-hold-slider-overlay]")).toHaveCount(0);
    await expect(pill).toContainText("High");
    // The trailing click was swallowed — no sheet.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The tap path is untouched: a plain click opens the sheet as before.
    await pill.click();
    const sheet = page.getByRole("dialog", { name: "Thinking depth" });
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByRole("radio", { name: "High", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
  });
});

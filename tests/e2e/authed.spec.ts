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

  test("glass stands down its blur while an authed page is scrolling", async ({
    page,
  }) => {
    // The signed-out version of this asserts on a form input. This one runs
    // over a real list of `.glass` cards — the case the optimisation exists
    // for, and the one where a dozen panels are on screen at once.
    await page.getByRole("navigation").getByRole("link", { name: "Library" }).click();
    await page.waitForURL(/\/library/);

    const card = page.locator("li.scroll-row a.glass").first();
    expect(await card.evaluate((el) => getComputedStyle(el).backdropFilter)).toContain(
      "blur",
    );

    await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
    await expect(page.locator("html")).toHaveAttribute("data-scrolling", "");
    expect(await card.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe("none");

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
    const animationName = () =>
      page.evaluate(
        () => getComputedStyle(document.querySelector(".horizon-node")!).animationName,
      );

    expect(await animationName()).toBe("horizon-breathe");

    await page.evaluate(() =>
      document.documentElement.toggleAttribute("data-reduced-effects", true),
    );
    expect(await animationName()).toBe("none");
  });

  test("the Horizon band keeps the footprint of the emblem it replaced", async ({
    page,
  }) => {
    // The emblem was `w-full max-w-[320px]` over a 320x64 viewBox, so its height
    // was min(bandWidth, 320) / 5 — 64px from 352px up, but SHORTER below that.
    // A flat `h-16` looks equivalent and silently grows the header on small
    // screens, which is the whole thing this swap was asked not to do.
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 860 });
      const band = page.locator(".horizon");
      const box = (await band.boundingBox())!;
      expect(box.height, `height at ${width}px`).toBeCloseTo(
        Math.min(box.width, 320) / 5,
        1,
      );
    }
  });

  test("settings renders the signed-in identity", async ({ page }) => {
    await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
    await page.waitForURL(/\/profile/);
    await expect(page.getByText("e2e@vasey.test")).toBeVisible();
    await expectNoUnhandledStubRoutes();
  });
});

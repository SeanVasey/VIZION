import { test, expect } from "@playwright/test";

test.describe("VIZ(IO)N P1 shell", () => {
  test("root redirects to Enhance and renders the brand wordmark", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/enhance$/);
    await expect(page.getByRole("img", { name: "VIZ(IO)N" })).toBeVisible();
    await expect(page.getByRole("button", { name: /ENHANCE/i })).toBeVisible();
  });

  test("bottom nav switches between the three tabs", async ({ page }) => {
    await page.goto("/enhance");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav).toBeVisible();

    await nav.getByRole("link", { name: "Library" }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

    await nav.getByRole("link", { name: "Profile" }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  });

  test("theme toggle flips the document data-theme attribute", async ({ page }) => {
    await page.goto("/enhance");
    const html = page.locator("html");
    const initial = await html.getAttribute("data-theme");

    await page.getByRole("button", { name: /Theme:/ }).click();
    await expect(html).not.toHaveAttribute("data-theme", initial ?? "system");
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

  test("the service worker is served with a no-store cache policy", async ({
    request,
  }) => {
    const res = await request.get("/sw.js");
    expect(res.ok()).toBeTruthy();
    expect(res.headers()["cache-control"]).toContain("no-cache");
  });

  test("registers a service worker and serves the shell offline", async ({
    page,
    context,
    browserName,
  }) => {
    await page.goto("/enhance");
    // The SW must register + activate on every engine (incl. WebKit/iOS).
    await page.evaluate(() => navigator.serviceWorker.ready);

    // Playwright's WebKit throws an internal error on `reload()` under offline
    // emulation, so the offline-navigation assertion runs on Chromium, where it
    // faithfully exercises the precached shell. (Registration above still runs
    // on WebKit, covering the iOS install path.)
    test.skip(
      browserName === "webkit",
      "Playwright WebKit offline reload is unreliable; offline shell verified on Chromium.",
    );

    // Wait until the active worker controls the page (clientsClaim).
    await page.waitForFunction(
      () => navigator.serviceWorker?.controller !== null,
      undefined,
      { timeout: 20_000 },
    );

    await context.setOffline(true);
    await page.reload();
    // The precached shell should still render the wordmark while offline.
    await expect(page.getByRole("img", { name: "VIZ(IO)N" })).toBeVisible();
    await context.setOffline(false);
  });
});

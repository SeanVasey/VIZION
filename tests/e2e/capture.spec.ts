import { test, devices, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signIn } from "./support/auth";

/**
 * README imagery capture — NOT part of the verification gate.
 *
 * Runs only when CAPTURE=1, and only on Chromium (one engine, so the committed
 * PNGs are deterministic — WebKit and Chromium disagree on font AA). It reuses
 * the e2e harness's production build + Supabase stub + real sign-in, so every
 * shot is of the SHIPPED app, not a mock. Regenerate with:
 *
 *   CAPTURE=1 npx playwright test capture.spec.ts --project=mobile-chrome
 *
 * The hero (docs/preview.png) follows the recorded recipe in tasks/lessons.md:
 * production build · /sign-in · iPhone 14 Pro · dark · full page. The old capture
 * predated the --laser retune and the Liquid Glass mark, so it showed a retired
 * identity (audit VAR-D1 recaptured it once; this encodes the recipe as code so
 * it never goes stale silently again).
 */
const DOCS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "docs",
);

// Settle every finite entrance animation before the shutter, so nothing is
// caught mid-fade (the footer rise, the hero lockup). Infinite animations (the
// ambient blooms) never finish and are left running — they are the backdrop.
async function settle(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => {
      const t = a.effect?.getTiming();
      return !t || t.iterations === Infinity || a.playState === "finished";
    }),
  );
}

test.describe("README capture", () => {
  test.skip(
    !process.env.CAPTURE,
    "capture-only; set CAPTURE=1 to regenerate README imagery",
  );
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== "chromium", "one engine for deterministic committed PNGs");
  });

  test("hero + surface gallery", async ({ browser }) => {
    await mkdir(DOCS, { recursive: true });
    const context = await browser.newContext({
      ...devices["iPhone 14 Pro"],
      colorScheme: "dark",
    });
    const page = await context.newPage();

    // 1. The hero: the sign-in gate, full page (the recorded recipe frame).
    await page.goto("/sign-in");
    await page.getByRole("heading", { level: 1 }).waitFor();
    await settle(page);
    await page.screenshot({ path: path.join(DOCS, "preview.png"), fullPage: true });

    // 2. Gallery — the shipped authed surfaces, viewport-framed. The diff view
    //    is deliberately absent: it only exists after a live provider run, which
    //    the e2e stub has no keys for (the route 503s), so there is nothing
    //    honest to capture here.
    await signIn(page);
    await page.waitForURL(/\/enhance$/);
    await settle(page);
    await page.screenshot({ path: path.join(DOCS, "shot-enhance.png") });

    await page.getByRole("navigation").getByRole("link", { name: "Library" }).click();
    await page.waitForURL(/\/library$/);
    await settle(page);
    await page.screenshot({ path: path.join(DOCS, "shot-library.png") });

    await context.close();
  });
});

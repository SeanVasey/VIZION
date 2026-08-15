import { test, devices, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { signIn } from "./support/auth";

/**
 * Design imagery for the dials (ADR-0014) — NOT part of the verification
 * gate. Runs only when CAPTURE_DIALS=1, and only on Chromium, for the same
 * reason capture.spec.ts pins one engine: WebKit and Chromium disagree on
 * font AA, so committed or circulated PNGs must come from one of them.
 *
 * It exists as CODE rather than as a note about how someone once took the
 * screenshots, which is the lesson capture.spec.ts records: a recipe that
 * lives only in a chat log goes stale silently, and the imagery then shows a
 * retired design while claiming to show the current one. Every frame here is
 * of the SHIPPED app through the real harness — production build, Supabase
 * stub, real sign-in.
 *
 *   CAPTURE_DIALS=1 DIAL_SHOT_DIR=./out \
 *     npx playwright test dial-capture.spec.ts --project=mobile-chrome
 *
 * The frames, in order: the rail at rest (dial + how-to line, no chevron) ·
 * the capsule latched mid-ladder · the top stop's burst · the top stop
 * settled after the ultra wash has flooded the fill · a live drag (pill
 * concealed, focus pair up) · the model sheet with its tuning dial · that
 * dial latched · that dial at its own top stop. Both themes, because the
 * peak caption's shimmer is a contrast decision that differs per theme (see
 * globals.css).
 */
const OUT = process.env.DIAL_SHOT_DIR ?? "/tmp/dial-shots";

async function settle(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => {
      const t = a.effect?.getTiming();
      return !t || t.iterations === Infinity || a.playState === "finished";
    }),
  );
}

test.describe("dial capture", () => {
  test.skip(!process.env.CAPTURE_DIALS, "capture-only");
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== "chromium", "one engine");
  });

  for (const scheme of ["dark", "light"] as const) {
    test(`dials — ${scheme}`, async ({ browser }) => {
      await mkdir(OUT, { recursive: true });
      const context = await browser.newContext({
        ...devices["iPhone 14 Pro"],
        colorScheme: scheme,
      });
      const page = await context.newPage();
      await signIn(page);
      await page.waitForURL(/\/enhance$/);
      // Drive the app's own theme knob rather than the OS preference: it
      // persists as an explicit choice and ThemeManager writes it straight
      // onto <html data-theme>, so this is the only way to be sure a pass is
      // the theme it claims.
      for (let i = 0; i < 3; i++) {
        if ((await page.locator("html").getAttribute("data-theme")) === scheme) break;
        await page.getByRole("button", { name: /^Theme:/ }).click();
      }
      await settle(page);

      const shot = (name: string) =>
        page.screenshot({ path: path.join(OUT, `${scheme}-${name}.png`) });

      // 1. The rail at rest: dial + coach tip, no chevron.
      await shot("01-rest");

      const dial = page.getByRole("slider", { name: "Thinking depth" });
      const box = (await dial.boundingBox())!;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      // 2. Latched by a tap, mid-ladder.
      await dial.click();
      await page.locator("[data-hold-slider-overlay]").waitFor();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(260);
      await shot("02-latched-mid");

      // 3. The top stop: wash + burst + cost caption. The settled frame
      // waits out the 1.2s flood (globals.css `.hold-slider-wash`).
      await page.keyboard.press("End");
      await page.waitForTimeout(180);
      await shot("03-peak-burst");
      await page.waitForTimeout(1300);
      await shot("04-peak-settled");
      await page.keyboard.press("Escape");

      // 5. Mid-DRAG, so the pill is concealed and the focus pair is up.
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.locator("[data-hold-slider-overlay]").waitFor();
      await page.mouse.move(cx - 2 * 44, cy, { steps: 6 });
      await page.waitForTimeout(220);
      await shot("05-dragging");
      await page.mouse.up();

      // 6. The tuning dial inside the model sheet.
      await page.getByRole("button", { name: /^Target model:/ }).click();
      await page.getByRole("dialog", { name: "Target model" }).waitFor();
      await page.waitForTimeout(320);
      await shot("06-sheet-rest");

      const tune = page.getByRole("slider", { name: "Auto routing preference" });
      await tune.click();
      await page.locator("[data-hold-slider-overlay]").waitFor();
      await page.waitForTimeout(260);
      await shot("07-sheet-latched");
      // Settled past the 1.2s wash, like frame 04 — Quality is an ultra stop.
      await page.keyboard.press("End");
      await page.waitForTimeout(1300);
      await shot("08-sheet-peak");

      await context.close();
    });
  }
});

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { signIn } from "./support/auth";

/**
 * Rendered accessibility (audit PRI-009): the "WCAG AA pass" claim in
 * CLAUDE.md §9 was unmeasured — no axe integration, no small-viewport project,
 * no zoom pass. This injects axe-core (already a dependency; no new package,
 * per the lockfile lesson) and asserts zero serious/critical violations on the
 * public gate and the core authed surfaces, plus a 320px reflow check that no
 * horizontal scroll appears (WCAG 1.4.10).
 */
const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.js"), "utf8");

interface AxeResult {
  violations: { id: string; impact: string | null; nodes: { target: string[] }[] }[];
}

async function analyze(page: import("@playwright/test").Page): Promise<AxeResult> {
  // Settle entry animations before auditing: axe reads computed colors at scan
  // time, so a scan landing inside the footer's rise-and-fade (0.8s delay +
  // 0.8s ramp, fill `both`) measures translucent text over the canvas and
  // reports a contrast violation the resting page does not have. Infinite
  // animations (the ambient blooms) never finish and are exempt; everything
  // finite must be done before axe looks.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => {
      const timing = a.effect?.getTiming();
      return !timing || timing.iterations === Infinity || a.playState === "finished";
    }),
  );
  // Evaluate the axe source in the page (CDP Runtime.evaluate is NOT subject
  // to the page's script-src CSP, unlike addScriptTag's inline <script> —
  // which the nonce policy correctly refuses, itself proof SEC-001 landed).
  await page.evaluate(AXE_SOURCE);
  return page.evaluate(async () => {
    // @ts-expect-error injected global
    return (await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    })) as AxeResult;
  });
}

function seriousOrCritical(result: AxeResult) {
  return result.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
}

test.describe("rendered accessibility (axe)", () => {
  test("the sign-in gate has no serious or critical WCAG violations", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page.getByRole("heading", { level: 1 }).waitFor();
    const found = seriousOrCritical(await analyze(page));
    expect(
      found,
      found.map((v) => `${v.id} @ ${v.nodes[0]?.target.join(" ")}`).join("\n"),
    ).toEqual([]);
  });

  test("the composer has no serious or critical WCAG violations", async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/enhance$/);
    const found = seriousOrCritical(await analyze(page));
    expect(
      found,
      found.map((v) => `${v.id} @ ${v.nodes[0]?.target.join(" ")}`).join("\n"),
    ).toEqual([]);
  });

  // The library and settings surfaces were previously outside the axe pass —
  // contrast was asserted on the gate and composer only, so a regression on the
  // panel-dense authed surfaces (library cards, settings rows, the chips and
  // toggles) would have shipped green. Both are reached through the real nav.
  test("the library has no serious or critical WCAG violations", async ({ page }) => {
    await signIn(page);
    await page.getByRole("navigation").getByRole("link", { name: "Library" }).click();
    await page.waitForURL(/\/library$/);
    const found = seriousOrCritical(await analyze(page));
    expect(
      found,
      found.map((v) => `${v.id} @ ${v.nodes[0]?.target.join(" ")}`).join("\n"),
    ).toEqual([]);
  });

  test("settings has no serious or critical WCAG violations", async ({ page }) => {
    await signIn(page);
    await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
    await page.waitForURL(/\/profile$/);
    const found = seriousOrCritical(await analyze(page));
    expect(
      found,
      found.map((v) => `${v.id} @ ${v.nodes[0]?.target.join(" ")}`).join("\n"),
    ).toEqual([]);
  });

  test("no horizontal scroll at a 320px viewport (WCAG 1.4.10 reflow)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await signIn(page);
    await expect(page).toHaveURL(/\/enhance$/);
    // The document must not be wider than the viewport — a horizontal
    // scrollbar at 320px is the reflow failure this guards against.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

/**
 * The same rendered-a11y pass in the LIGHT polarity.
 *
 * Contrast is a property of the resolved token cascade, and the dark and light
 * blocks in tokens.css are independent — a value that clears AA on Void can fail
 * on the #EEF0F4 canvas (and did, historically: the light --accent-ink is a
 * separate #526810, not a tint of Laser). The dark scans above said nothing
 * about it. Forcing `data-theme="light"` drives the real `:root[data-theme]`
 * block; the guard proves the light cascade actually took before axe reads
 * colours, so a scan that silently stayed dark cannot pass as a light one.
 */
// Prove the light cascade actually took before axe reads colours — a scan that
// silently stayed dark cannot pass as a light one. `--void` resolves to the
// light canvas #EEF0F4 only under the light block.
async function expectLightVoid(page: import("@playwright/test").Page) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--void")
          .trim()
          .toLowerCase(),
      ),
    )
    .toBe("#eef0f4");
}

test.describe("rendered accessibility (axe) — light theme", () => {
  test("the sign-in gate has no serious or critical WCAG violations on light", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page.getByRole("heading", { level: 1 }).waitFor();
    // Pre-auth there is no ThemeManager/ProfileHydrator sync to fight, so forcing
    // the attribute drives the :root[data-theme="light"] block directly.
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
    });
    await expectLightVoid(page);
    const found = seriousOrCritical(await analyze(page));
    expect(
      found,
      found.map((v) => `${v.id} @ ${v.nodes[0]?.target.join(" ")}`).join("\n"),
    ).toEqual([]);
  });

  test("the composer has no serious or critical WCAG violations on light", async ({
    page,
  }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/enhance$/);
    // Authed surfaces differ from the gate: ProfileHydrator syncs the profile's
    // (dark) theme into the store AFTER mount, so a manual data-theme override
    // gets clobbered when that settle lands late (a race WebKit lost under
    // load). Drive the store through the app's own Settings segment instead —
    // ThemeManager then applies light and it survives the walk back to /enhance.
    await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
    await page.waitForURL(/\/profile$/);
    await page
      .getByRole("group", { name: "Theme" })
      .getByRole("button", { name: "light", exact: true })
      .click();
    await expectLightVoid(page);
    await page.getByRole("navigation").getByRole("link", { name: "Enhance" }).click();
    await page.waitForURL(/\/enhance$/);
    await expectLightVoid(page);
    const found = seriousOrCritical(await analyze(page));
    expect(
      found,
      found.map((v) => `${v.id} @ ${v.nodes[0]?.target.join(" ")}`).join("\n"),
    ).toEqual([]);
  });
});

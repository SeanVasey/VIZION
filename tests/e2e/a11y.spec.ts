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

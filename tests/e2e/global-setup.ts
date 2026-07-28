import { existsSync } from "node:fs";
import { chromium, firefox, webkit, type FullConfig } from "@playwright/test";
import { resetStubState } from "./support/stub-control";

const ENGINES = { chromium, firefox, webkit };
type EngineName = keyof typeof ENGINES;

/**
 * Preflight: fail once, clearly, when a configured project's browser is not
 * installed — before a single test runs.
 *
 * This exists because of a specific way this suite has already lied to us. The
 * `mobile-safari` project sat in the config for weeks looking like WebKit
 * coverage while WebKit was never installed, so it had never executed once.
 * What that looks like when you finally run it is N *identical* launch errors,
 * one per test, reported as "16 failed" — which reads as a broken test suite,
 * or as somebody else's environment problem, rather than as "an entire browser
 * is missing and everything you believed it verified is unverified."
 * `tasks/lessons.md` records the cost of that; this is the guard.
 *
 * The distinction matters most for this app: the bottom nav's press feedback
 * exists to work around a WebKit-only quirk (`:active` needs a document touch
 * listener). A green Chromium run says nothing about it. So a missing WebKit
 * has to be an unmissable, actionable stop — never a quiet skip.
 */
export default async function globalSetup(config: FullConfig) {
  assertBrowsersInstalled(config);
  // Playwright starts `webServer` plugins before `globalSetup`, so the stub is
  // listening by now — and its state is whatever the LAST run left behind
  // whenever `reuseExistingServer` reused the process. See `stub-control.ts`.
  await resetStubState();
}

function assertBrowsersInstalled(config: FullConfig) {
  const wanted = new Map<EngineName, string[]>();

  for (const project of config.projects) {
    const use = project.use as {
      browserName?: EngineName;
      defaultBrowserType?: EngineName;
    };
    // Explicit `browserName` wins; device descriptors (devices["iPhone 14 Pro"])
    // carry `defaultBrowserType` instead.
    const engine = use.browserName ?? use.defaultBrowserType ?? "chromium";
    wanted.set(engine, [...(wanted.get(engine) ?? []), project.name]);
  }

  const missing: string[] = [];
  for (const [engine, projects] of wanted) {
    let path: string;
    try {
      path = ENGINES[engine].executablePath();
    } catch (err) {
      missing.push(`  ${engine} (${projects.join(", ")}) — ${(err as Error).message}`);
      continue;
    }
    if (!existsSync(path)) {
      missing.push(`  ${engine} (${projects.join(", ")}) — expected at ${path}`);
    }
  }

  if (missing.length) {
    throw new Error(
      [
        "",
        `Playwright cannot run: ${missing.length} configured browser(s) are not installed.`,
        ...missing,
        "",
        `Install them:  npx playwright install ${[...wanted.keys()].join(" ")}`,
        "  (add --with-deps on Linux if system libraries are missing too)",
        "",
        "Do NOT work around this by deleting the project from playwright.config.ts.",
        "A project that never runs is worse than no project: it reads as coverage.",
        "",
      ].join("\n"),
    );
  }
}

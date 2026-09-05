import { test, expect } from "@playwright/test";
import {
  verifyIconBrowser,
  verifyIconFallbackBrowser,
} from "../../scripts/check-icon-browser.mjs";

test("SVG presentation fallback remains lime without its stylesheet", async ({
  page,
}, info) => {
  const result = await verifyIconFallbackBrowser(page);
  expect(result.checks).toHaveLength(6);
  for (const [name, body] of Object.entries(result.screenshots)) {
    await info.attach(name, { body, contentType: "image/png" });
  }
});

test("SVG CSS overrides the presentation fallback without changing the mark", async ({
  page,
  browserName,
}, info) => {
  // Same engine boundary as shell.spec.ts: Linux WebKit's external-SVG media
  // behavior is not a proxy for iPhone Home Screen selection. The fallback
  // test above still runs in both configured engines.
  test.skip(
    browserName !== "chromium",
    "External-SVG scheme rendering is scoped to Chromium; physical iOS acceptance is separate",
  );
  const result = await verifyIconBrowser(page);
  expect(result.checks).toHaveLength(3);
  for (const [name, body] of Object.entries(result.screenshots)) {
    await info.attach(name, { body, contentType: "image/png" });
  }
});

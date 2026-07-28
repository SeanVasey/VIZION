import { expect, type Page } from "@playwright/test";
import { readUnhandledStubRoutes } from "./stub-control";

/** Must match the fixture in `supabase-stub.mjs`. */
export const E2E_USER = {
  email: "e2e@vasey.test",
  password: "e2e-password-1234",
};

/**
 * Sign in through the real form, against the stub Supabase.
 *
 * Deliberately drives the UI rather than injecting cookies: the browser
 * `@supabase/ssr` client owns its own cookie names and shapes, and a
 * hand-forged cookie would be testing our guess at that contract instead of
 * the product. Signing in for real also means the middleware, the `(app)`
 * layout's onboarding gate and the profile hydration all execute exactly as
 * they do for a user.
 *
 * The form does a full `window.location.assign` after `signInWithPassword`
 * (so middleware sees the fresh cookies), hence waiting on the URL rather than
 * a client-side transition.
 */
export async function signIn(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Have a password/i }).click();
  await page.locator("input#email").fill(E2E_USER.email);
  await page.locator("input#password").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/enhance/);
  // The nav only renders on authed surfaces, so its presence is the signal
  // that we are actually inside the app and not on a redirect bounce.
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
}

/**
 * Fail the test if the stub was asked for anything it does not implement.
 *
 * Without this an unimplemented PostgREST route returns 501, the app swallows
 * it as "no rows", and a spec asserting an empty state passes for entirely the
 * wrong reason. Call it after a flow that touches new data.
 *
 * The list is process-global to the stub and only ever cleared between runs
 * (`global-setup.ts`), so this reports anything any worker has hit so far —
 * deliberately over-eager rather than under.
 */
export async function expectNoUnhandledStubRoutes(): Promise<void> {
  expect(
    await readUnhandledStubRoutes(),
    "stub Supabase received routes it does not implement",
  ).toEqual([]);
}

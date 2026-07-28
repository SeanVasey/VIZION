import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * The stub Supabase (tests/e2e/support/supabase-stub.mjs). Pointing
 * `NEXT_PUBLIC_SUPABASE_URL` at it is the ONLY thing that makes the authed
 * surfaces reachable — there is deliberately no test-only auth branch in
 * `src/`, so the specs drive the real middleware, the real `@supabase/ssr`
 * clients and the real sign-in form. See the stub's header for why.
 *
 * The anon key is a throwaway: the stub never checks it, and it is not a
 * credential for anything that exists.
 */
const STUB_PORT = 54321;
const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;

/**
 * Shell / PWA e2e. We build the service worker, then run a production server so
 * the SW + manifest behave as they would in deployment.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // Fails once, with an actionable message, if a configured project's browser
  // is missing — instead of N identical launch errors that read as a broken
  // suite. See the file for the incident this guards against.
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14 Pro"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: [
    {
      // Must be listening before the app builds: `NEXT_PUBLIC_*` is inlined
      // into the client bundle at BUILD time, so the browser's Supabase client
      // is pinned to this origin by `next build` below.
      command: "node tests/e2e/support/supabase-stub.mjs",
      url: `${STUB_URL}/auth/v1/settings`,
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
      env: { SUPABASE_STUB_PORT: String(STUB_PORT) },
    },
    {
      command: `npm run build:sw && npx next build && npx next start -p ${PORT}`,
      url: baseURL,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: {
        // This server is plain http on loopback. `upgrade-insecure-requests`
        // would rewrite every subresource to https, where nothing is
        // listening, and WebKit (unlike Chromium, which exempts loopback)
        // would then render every page with no CSS. The flag is read at BUILD
        // time — hence set for the whole chained command, not just
        // `next start`. See next.config.ts.
        VIZION_HTTP_ORIGIN: "1",
        NEXT_PUBLIC_SUPABASE_URL: STUB_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-stub-anon-key",
      },
    },
  ],
});

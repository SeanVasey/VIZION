import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * Shell / PWA e2e. We build the service worker, then run a production server so
 * the SW + manifest behave as they would in deployment.
 */
export default defineConfig({
  testDir: "./tests/e2e",
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
  webServer: {
    command: `npm run build:sw && npx next build && npx next start -p ${PORT}`,
    url: baseURL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    // This server is plain http on loopback. `upgrade-insecure-requests` would
    // rewrite every subresource to https, where nothing is listening, and
    // WebKit (unlike Chromium, which exempts loopback) would then render every
    // page with no CSS. The flag is read at BUILD time — hence set for the
    // whole chained command, not just `next start`. See next.config.ts.
    env: { VIZION_HTTP_ORIGIN: "1" },
  },
});

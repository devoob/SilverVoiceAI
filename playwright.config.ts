import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against the production build (`next start`), because that is what
 * gets demoed. `pretest:e2e` rebuilds first.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Headless Chromium has no Web Speech API, so e2e/speech-stub.js is
    // injected into every page to drive the recognition pipeline.
    viewport: { width: 1440, height: 1024 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run start -- --port 3100 --hostname 127.0.0.1",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});

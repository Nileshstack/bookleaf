import { defineConfig, devices } from "@playwright/test";

/**
 * UI end-to-end suite: `npm run test:e2e`.
 *
 * Starts an isolated stack, so a running dev setup (3000/5000) is untouched:
 * - API on :5100 with an in-memory MongoDB seeded from the dataset and a
 *   fake OpenAI upstream on :5199 (server/scripts/e2e-stack.js);
 * - this app as a production build on :3100 in same-origin proxy mode.
 *
 * Screenshots land in /qa-screenshots, the HTML report in /qa/playwright-report.
 */
export const API_URL = "http://127.0.0.1:5100";
export const FAKE_AI_URL = "http://127.0.0.1:5199";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../qa/playwright-results",
  fullyParallel: false,
  workers: 1, // one shared seeded database; tests build on each other's tickets
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "../qa/playwright-report", open: "never" }],
  ],
  use: {
    baseURL: "http://localhost:3100",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: [
    {
      command: "node ../server/scripts/e2e-stack.js",
      url: `${API_URL}/api/v1/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: "npm run e2e:serve",
      url: "http://localhost:3100/login",
      timeout: 600_000,
      reuseExistingServer: true,
      env: {
        NEXT_DIST_DIR: ".next-e2e",
        NEXT_PUBLIC_API_URL: "/api/v1",
        API_PROXY_TARGET: API_URL,
      },
    },
  ],
});

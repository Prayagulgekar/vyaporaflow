import { defineConfig, devices } from "@playwright/test";

const port = process.env.E2E_PORT ?? "3100";
const baseURL = `http://localhost:${port}`;

/**
 * End-to-end workflows A-E against a fresh demo database. Tests run in order
 * on one worker because they share that database (workflow B's order is the
 * one later workflows can see).
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure", locale: "en-IN", timezoneId: "Asia/Kolkata" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx tsx scripts/e2e-server.ts",
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI && process.env.E2E_REUSE === "1",
    timeout: 300_000,
    stdout: "pipe",
  },
});

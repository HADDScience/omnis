import { defineConfig, devices } from "@playwright/test"

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000"
const IS_REMOTE = /^https?:\/\//.test(BASE_URL) && !BASE_URL.includes("localhost")

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: IS_REMOTE ? 2 : 1,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "feature",
      testDir: "./tests/feature",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "legacy",
      testDir: "./tests",
      testIgnore: /tests\/feature\//,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})

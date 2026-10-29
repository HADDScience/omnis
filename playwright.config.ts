import { defineConfig, devices } from "@playwright/test"

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000"
const IS_REMOTE =
  /^https?:\/\//.test(BASE_URL) && !BASE_URL.includes("localhost")

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
    trace: process.env.E2E_ISOLATED === "true" ? "off" : "retain-on-failure",
    video: process.env.E2E_ISOLATED === "true" ? "off" : "retain-on-failure",
  },
  projects: [
    {
      name: "feature",
      testDir: "./tests/feature",
      grepInvert: /@mobile/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // 폰 화면 게이트 — @mobile 태그만 돈다. PC 용 테스트를 폰 크기로 돌려 봐야 대부분 의미가 없다.
      // CI 는 Chromium 만 깔므로 iPhone(WebKit) 대신 Chromium 에 390px 터치 화면을 준다 (2026-10-29)
      name: "mobile",
      testDir: "./tests/feature",
      grep: /@mobile/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      // 실제 도입 흐름 — 사람 여럿이 동시에 움직이는 긴 시나리오. 목킹 없음, Gemini 실호출.
      name: "scenario",
      testDir: "./tests/scenario",
      timeout: 15 * 60_000,
      retries: 0,
      // channel: "chromium" — headless shell 대신 Chrome for Testing 본체(new headless)를 쓴다
      // 영상·트레이스는 기본 끔 — 폴링으로 화면이 계속 바뀌어 4명 × 5분에 수 GB 를 썼다.
      // 눈으로 보려면 --headed, 기록이 필요하면 --trace on (스크린샷 없는 트레이스는 수십 MB).
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium",
        actionTimeout: 15_000,
        video: "off",
        trace: "off",
        screenshot: "only-on-failure",
      },
    },
    {
      name: "legacy",
      testDir: "./tests",
      testIgnore: /tests\/feature\//,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})

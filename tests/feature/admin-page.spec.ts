/**
 * 관리자 페이지(/admin) — 관리자만 연다(그 외 404 · API 403) · 메뉴 넷 · 계정 목록에 비밀번호 · 해시 · 원래 메일이 없다 ·
 * 잠금 해제가 실제로 풀고 기록 탭에 남는다.
 *
 *   pnpm run test:e2e:local tests/feature/admin-page.spec.ts
 *
 * 잠금은 시험 DB 에 실패 기록을 직접 넣어 만든다(격리된 DB 에서만). ADMIN_SHOTS 에 절대 경로를 주면 화면을 남긴다.
 */
import { createHash } from "node:crypto"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { quickLogin } from "./_setup"

const shots = process.env.ADMIN_SHOTS
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: path.join(shots, name), fullPage: true })
}
// lib/login-guard.ts 의 accountKey 와 같은 모양
const accountKey = (name: string) => `acct:${createHash("sha256").update(name.normalize("NFC").trim().toLowerCase()).digest("hex").slice(0, 32)}`

test.describe.configure({ mode: "serial" })

test("구성원 — 화면은 404, API 는 403 · 로그인 안 하면 401", async ({ page }) => {
  await quickLogin(page, "사원1")
  for (const p of ["/admin", "/admin/users", "/admin/audit"]) {
    await page.goto(p)
    await expect(page.getByText(/could not be found|찾을 수 없/i).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator("[data-admin-nav]")).toHaveCount(0)
  }
  expect((await page.request.get("/api/admin/users")).status()).toBe(403)
  expect((await page.request.get("/api/admin/login-codes")).status()).toBe(403)
  expect((await page.request.post("/api/admin/users/anyone/unlock")).status()).toBe(403)
  expect((await page.request.post("/api/admin/onboarding", { data: { action: "replay", userIds: ["anyone"] } })).status()).toBe(403)
  await page.goto("/settings?tab=info")
  await expect(page.locator("[data-admin-links]")).toHaveCount(0)
  await page.context().clearCookies()
  expect((await page.request.get("/api/admin/users")).status()).toBe(401)
  expect((await page.request.post("/api/admin/onboarding", { data: { action: "dismiss", userIds: ["anyone"] } })).status()).toBe(401)
})

test("관리자 — 메뉴 넷 · 계정 목록에 비밀번호 · 해시 · 원래 메일이 없다", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await quickLogin(page, "팀장")
  await page.goto("/admin")
  await page.waitForURL("**/admin/users")
  const nav = page.locator("[data-admin-nav]")
  const labels = await nav.getByRole("link").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))
  expect(labels).toEqual(["사용자", "운영", "비용·사용량", "기록"])
  await expect(nav.getByRole("link", { name: "사용자" })).toHaveAttribute("aria-current", "page")
  await expect(page.locator('[data-admin-user="사원1"]')).toBeVisible()
  const html = await page.content()
  expect(html).not.toMatch(/\$2[aby]\$\d\d\$/)
  expect(html).not.toContain("passwordHash")

  const res = await page.request.get("/api/admin/users")
  expect(res.status()).toBe(200)
  const body = await res.text()
  expect(body).not.toMatch(/\$2[aby]\$\d\d\$|passwordHash|"email"/)
  const { users } = JSON.parse(body) as { users: { maskedEmail: string | null }[] }
  for (const u of users) if (u.maskedEmail) expect(u.maskedEmail).toContain("•")
  const codes = await (await page.request.get("/api/admin/login-codes")).text()
  expect(codes).not.toContain("title")
  await shot(page, "01-users-pc.png")

  for (const [label, url, mark] of [
    ["운영", "**/admin/operations", "[data-admin-survey]"],
    ["비용·사용량", "**/admin/usage", "[data-ai-budget-form]"],
    ["기록", "**/admin/audit", "[data-admin-audit]"],
  ] as const) {
    await nav.getByRole("link", { name: label }).click()
    await page.waitForURL(url)
    await expect(page.locator(mark)).toBeVisible({ timeout: 30_000 })
    await shot(page, `02-${url.split("/").pop()}-pc.png`)
  }
  // 기존 주소는 그대로 열린다
  await page.goto("/settings/ai-budget")
  await expect(page.locator("[data-ai-budget-form]")).toBeVisible({ timeout: 30_000 })
})

test("잠금 해제 — 실패 다섯 번으로 잠긴 계정을 풀면 기록 탭에 남고 다시 로그인된다", async ({ page }) => {
  test.skip(process.env.E2E_ISOLATED !== "true", "시험 DB 에 실패 기록을 직접 넣는다 — 격리된 DB 에서만")
  const prisma = new PrismaClient()
  try {
    const now = Date.now()
    await prisma.activityLog.createMany({
      data: [1, 2, 3, 4, 5].map((m) => ({ entity: "auth.login", entityId: accountKey("사원3"), action: "fail", title: "로그인 실패", createdAt: new Date(now - m * 60_000) })),
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await quickLogin(page, "팀장")
    await page.goto("/admin/users")
    const card = page.locator('[data-admin-user-card="사원3"]')
    await expect(card.locator('[data-lock-state="locked"]')).toBeVisible({ timeout: 30_000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await shot(page, "03-users-phone-locked.png")
    await card.locator("[data-unlock]").click()
    await expect(card.locator('[data-lock-state="open"]')).toBeVisible({ timeout: 15_000 })
    // 잠기지 않은 계정을 다시 풀면 409
    const id = (await prisma.user.findFirstOrThrow({ where: { name: "사원3" }, select: { id: true } })).id
    expect((await page.request.post(`/api/admin/users/${id}/unlock`)).status()).toBe(409)

    await page.locator("[data-admin-nav]").getByRole("link", { name: "기록" }).click()
    await page.waitForURL("**/admin/audit")
    const row = page.locator('[data-audit-action="admin.login_unlocked"]').first()
    await expect(row).toContainText("로그인 잠금 해제 — 사원3")
    await expect(row).toContainText("팀장")
    await shot(page, "04-audit-phone.png")
    // 공개 활동 기록에는 나오지 않는다
    const pub = (await (await page.request.get("/api/activity?take=50")).json()) as { logs: { entity: string }[] }
    expect(pub.logs.some((l) => l.entity === "admin")).toBe(false)

    await page.context().clearCookies()
    await quickLogin(page, "사원3")
  } finally {
    await prisma.$disconnect()
  }
})

test("온보딩 — 줄마다 다시 띄우기 · 끄기, 체크해서 여러 명 한꺼번에, 값만 바뀌고 기록 탭에 남는다", async ({ page }) => {
  test.skip(process.env.E2E_ISOLATED !== "true", "시험 DB 를 직접 읽는다 — 격리된 DB 에서만")
  const prisma = new PrismaClient()
  const read = (name: string) => prisma.user.findFirstOrThrow({ where: { name }, select: { id: true, onboardingVersion: true, onboardingCompletedAt: true } })
  const original = await prisma.user.findMany({ where: { name: { in: ["사원1", "사원2"] } }, select: { id: true, onboardingVersion: true } })
  try {
    const before = await read("사원2")
    await page.setViewportSize({ width: 1280, height: 900 })
    await quickLogin(page, "팀장")
    await page.goto("/admin/users")
    const current = Number((await page.locator("[data-admin-onboarding] [data-onboarding-version]").innerText()).replace(/\D/g, ""))
    expect(current).toBeGreaterThan(0)
    // 「모두에게」 단추는 사용자 탭 표 위에 있고, 운영 탭에는 링크만
    await expect(page.locator("[data-admin-onboarding] [data-onboarding-replay]")).toBeVisible()

    const row = page.locator('[data-admin-user="사원2"]')
    await row.locator('[data-onboarding-row-replay="사원2"]').click()
    await expect(row.locator('[data-onboarding-state="due"]')).toBeVisible({ timeout: 15_000 })
    let after = await read("사원2")
    expect(after.onboardingVersion).toBe(current - 1)
    expect(after.onboardingCompletedAt?.getTime() ?? null).toBe(before.onboardingCompletedAt?.getTime() ?? null)
    expect(after.id).toBe(before.id)

    await row.locator('[data-onboarding-row-dismiss="사원2"]').click()
    await expect(row.locator('[data-onboarding-state="seen"]')).toBeVisible({ timeout: 15_000 })
    after = await read("사원2")
    expect(after.onboardingVersion).toBe(current)
    expect(after.onboardingCompletedAt?.getTime() ?? null).toBe(before.onboardingCompletedAt?.getTime() ?? null)

    // 여러 명 — 사원1 · 사원2 체크 → 다시 띄우기
    await page.getByRole("checkbox", { name: "사원1 고르기" }).first().click()
    await page.getByRole("checkbox", { name: "사원2 고르기" }).first().click()
    await expect(page.locator("[data-onboarding-bulk]")).toContainText("2명 고름")
    await page.locator("[data-onboarding-bulk-replay]").click()
    for (const n of ["사원1", "사원2"]) await expect(page.locator(`[data-admin-user="${n}"] [data-onboarding-state="due"]`)).toBeVisible({ timeout: 15_000 })
    expect((await read("사원1")).onboardingVersion).toBe(current - 1)
    // 1280 에서 표가 틀 안에 들어간다 — 끄기 단추 · 잠금 칸이 잘리지 않는다
    const wrap = page.locator("[data-admin-users] table").locator("..")
    expect(await wrap.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    await expect(row.locator('[data-onboarding-row-dismiss="사원2"]')).toBeInViewport()
    await shot(page, "05-onboarding-pc.png")

    // 잘못된 요청은 400
    expect((await page.request.post("/api/admin/onboarding", { data: { action: "wipe", userIds: [before.id] } })).status()).toBe(400)
    expect((await page.request.post("/api/admin/onboarding", { data: { action: "replay", userIds: [] } })).status()).toBe(400)

    await page.locator("[data-admin-nav]").getByRole("link", { name: "기록" }).click()
    await page.waitForURL("**/admin/audit")
    await expect(page.locator('[data-audit-action="admin.onboarding_replay_user"]').first()).toContainText("팀장")
    await expect(page.locator('[data-audit-action="admin.onboarding_dismiss_user"]').first()).toContainText("온보딩 끄기 — 사원2")
    expect(await page.locator('[data-audit-action="admin.onboarding_replay_user"]').count()).toBeGreaterThanOrEqual(3)

    await page.locator("[data-admin-nav]").getByRole("link", { name: "운영" }).click()
    await expect(page.locator("[data-admin-onboarding-link]")).toBeVisible()
    await expect(page.locator("[data-onboarding-replay]")).toHaveCount(0)

    // 폰 — 묶음에도 같은 단추 · 가로로 넘치지 않는다
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/admin/users")
    await expect(page.locator('[data-admin-user-card="사원1"] [data-onboarding-row-dismiss="사원1"]')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await shot(page, "06-onboarding-phone.png")
  } finally {
    // 사원1 · 사원2 의 판을 시험 전 값 그대로 돌려 둔다 — 뒤따르는 onboarding.spec 이 처음 상태를 기대한다
    for (const o of original) await prisma.user.update({ where: { id: o.id }, data: { onboardingVersion: o.onboardingVersion } })
    await prisma.$disconnect()
  }
})

/**
 * 로그인 코드(2026-11-12) — 코드 받기 → (메일은 MAIL_OUTBOX_DIR 로 떨군다) → 코드로 로그인 → 새 비밀번호 강제.
 * 지키는 것: 응답 문구는 계정 유무와 같다 · 코드로 들어오면 앱 대신 비밀번호 만들기 · 건너뛰기 없음
 * 규칙: lib/login-code.ts · 메일 계층: lib/mailer.ts
 */
import fs from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { hideSurveyBanner } from "./_setup"

const OUTBOX = process.env.MAIL_OUTBOX_DIR
test.skip(!OUTBOX, "MAIL_OUTBOX_DIR 가 있어야 코드 메일을 읽는다")

const prisma = new PrismaClient()
const NAME = "사원2"
let originalHash = ""
let email: string | null = null

test.beforeAll(async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { name: NAME } })
  originalHash = u.passwordHash
  email = u.email
  await prisma.user.update({ where: { id: u.id }, data: { email: "e2e-code@haddscience.com" } })
})
test.afterAll(async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { name: NAME } })
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: originalHash, email } })
  await prisma.activityLog.deleteMany({ where: { entityId: u.id, entity: { in: ["auth.code", "auth.password"] } } })
  await prisma.$disconnect()
})

function latestCode(since: number): string | null {
  if (!fs.existsSync(OUTBOX!)) return null
  const files = fs.readdirSync(OUTBOX!).filter((f) => Number(f.split("-")[0]) >= since).sort()
  for (const f of files.reverse()) {
    const m = JSON.parse(fs.readFileSync(path.join(OUTBOX!, f), "utf8")) as { to: string; text: string }
    if (m.to === "e2e-code@haddscience.com") return m.text.match(/\b(\d{6})\b/)?.[1] ?? null
  }
  return null
}

test("코드 받기 → 코드로 로그인 → 새 비밀번호를 만들어야 앱으로", async ({ page }) => {
  await hideSurveyBanner(page)
  await page.goto("/login")
  await page.getByRole("button", { name: "처음 로그인하시나요? · 비밀번호를 잊으셨나요?" }).click()

  // 없는 계정도 같은 문구
  await page.getByLabel("이름 또는 웍스 메일").fill("없는사람-e2e")
  await page.getByRole("button", { name: "로그인 코드 받기" }).click()
  await expect(page.getByRole("status")).toContainText("등록된 계정이면 웍스 메일로 코드를 보냈습니다")

  const since = Date.now() - 1000
  await page.getByLabel("이름 또는 웍스 메일").fill("E2E-CODE@haddscience.com")
  await page.getByRole("button", { name: "코드 다시 받기" }).click()
  await expect.poll(() => latestCode(since), { timeout: 15_000 }).not.toBeNull()
  const code = latestCode(since)!

  await page.getByLabel("로그인 코드", { exact: true }).fill(code)
  await page.getByRole("button", { name: "코드로 로그인" }).click()
  await page.waitForURL("**/account/password", { timeout: 30_000 })
  await expect(page.getByRole("link", { name: "나중에" })).toHaveCount(0)
  await expect(page.locator("#current-password")).toHaveCount(0)

  // 건너뛰기 없음 — 앱 화면으로 가도 다시 비밀번호 화면
  await page.goto("/chat")
  await page.waitForURL("**/account/password", { timeout: 30_000 })

  await page.locator("#new-password").fill("e2e-new-password-1234")
  await page.locator("#confirm-password").fill("e2e-new-password-1234")
  await page.getByRole("button", { name: "비밀번호 바꾸기" }).click()
  await page.waitForURL("**/chat", { timeout: 30_000 })

})

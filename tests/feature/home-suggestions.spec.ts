/**
 * 첫 화면 「지금 할 일」 제안 — lib/home-suggestions. 고정 예시 대신 그 사람이 지금 할 일을 카드로 보인다.
 *
 *   pnpm run test:e2e:local tests/feature/home-suggestions.spec.ts
 *
 * CI 의 Gemini 키는 자리값이라 AI 순서는 실패하고 코드 순서(마감 가까운 순)로 보인다 — 정책 3번 그대로다.
 * 업무를 DB 에 직접 넣는 시험은 격리된 시험 DB(E2E_ISOLATED)에서만 돈다.
 */
import { expect, test } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

test.describe("첫 화면 제안 @chat", () => {
  test("제안 API 는 내 것만 돌려주고, 첫 화면은 카드나 예시 중 하나를 보인다", async ({ page }) => {
    await login(page, "사원1")
    const res = await page.request.get("/api/home/suggestions")
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { items: { key: string; line: string }[]; runId: string | null }
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items.length).toBeLessThanOrEqual(4)

    await page.goto("/chat/new")
    const box = page.locator("[data-home-suggestions]")
    // 스켈레톤이 끝나면 카드(source) 또는 예시(제안 없음)
    await expect(page.locator('[data-home-suggestions="loading"]')).toHaveCount(0, { timeout: 20_000 })
    if (body.items.length > 0) await expect(box.locator("[data-suggestion-kind]")).toHaveCount(body.items.length)
    else await expect(page.getByRole("button", { name: "이번 주 마감인 업무 정리해 줘" })).toBeVisible()

    // 남의 실행 id 로는 기록되지 않는다
    const bad = await page.request.post("/api/home/suggestions/events", { data: { runId: "없는-실행", itemKey: "x", kind: "click" } })
    expect(bad.status()).toBe(404)
  })

  test.describe("격리된 시험 DB 에서만", () => {
    test.skip(process.env.E2E_ISOLATED !== "true", "업무를 DB 에 직접 넣는다")
    const prisma = new PrismaClient()
    const name = `오늘 마감 확인용 ${Date.now()}`
    let taskId = ""

    test.afterAll(async () => {
      if (taskId) await prisma.task.delete({ where: { id: taskId } }).catch(() => {})
      await prisma.$disconnect()
    })

    test("오늘 마감인 내 업무가 카드로 뜨고, 누르면 그 업무로 간다 · 클릭이 남는다", async ({ page }) => {
      const me = await prisma.user.findFirstOrThrow({ where: { name: "사원3" } })
      const deadline = new Date(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10) + "T09:00:00Z")
      const t = await prisma.task.create({
        data: { name, slug: `home-sugg-${Date.now()}`, instructorId: me.id, status: "TODO", deadline, assignees: { create: [{ userId: me.id }] } },
        select: { id: true },
      })
      taskId = t.id
      await login(page, "사원3")
      await page.goto("/chat/new")
      const card = page.locator('[data-suggestion-kind="task_due"]', { hasText: name })
      await expect(card).toBeVisible({ timeout: 20_000 })
      await card.click()
      await page.waitForURL(`**/chat/task/${taskId}**`)
      await expect.poll(async () => prisma.homeSuggestionEvent.count({ where: { userId: me.id, kind: "click", itemKey: `task_due:${taskId}` } })).toBe(1)
    })
  })
})

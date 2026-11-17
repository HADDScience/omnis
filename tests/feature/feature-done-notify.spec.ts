/**
 * 기능 요청 완료 알림(2026-11-17) — 관리자가 완료로 바꾸며 바뀐 것 한 줄 · 써 볼 곳을 적으면
 * 그 요청을 남긴 사람(바꾼 사람 빼고)의 벨에 뜨고, 「써 보기」 는 그곳으로, 「답장」 은 기능 요청 쪽으로 간다.
 * 계획: mydocs/plans/2026-11-17-feature-done-notify.md
 */
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { quickLogin } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")

test.use({ viewport: { width: 1280, height: 860 } })

async function quiet(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("omnis:nudge-off:install", "1")
    localStorage.setItem("omnis:nudge-off:push", "1")
  })
}

test("완료로 바꾸면 요청한 사람에게 한 번 알리고, 써 보기 · 답장이 된다", async ({ browser }) => {
  test.skip(!LOCAL_DB, "시험 DB 를 직접 쓰고 읽는다")
  const prisma = new PrismaClient()
  const marker = `완료알림시험 ${Date.now()}`
  const [admin, member, other] = await Promise.all(
    ["팀장", "사원1", "사원2"].map((name) => prisma.user.findFirstOrThrow({ where: { name }, select: { id: true } })),
  )
  const fr = await prisma.featureRequest.create({
    data: {
      key: `donenotify${Date.now()}`,
      title: marker,
      count: 2,
      entries: { create: [{ requesterId: member.id, detail: "목록에서 바로 열고 싶어요" }, { requesterId: admin.id, detail: "같은 것" }] },
    },
  })
  try {
    // ① 관리자 — 완료 단추는 창을 띄우고, 받을 사람은 나를 뺀 1명
    const a = await browser.newPage()
    await quiet(a)
    await quickLogin(a, "팀장")
    await a.goto("/settings/feature-requests")
    const row = a.locator(`[data-feature-request="${fr.id}"]`)
    await row.getByRole("button", { name: "완료" }).click()
    const dialog = a.getByRole("dialog", { name: "완료로 바꾸기" })
    await expect(dialog).toContainText("1명(사원1)")
    const send = dialog.getByRole("button", { name: "완료로 바꾸고 알리기" })
    await expect(send).toBeDisabled()
    await dialog.getByRole("textbox", { name: "바뀐 것" }).fill("목록에서 바로 엽니다")
    await dialog.getByRole("textbox", { name: "써 볼 곳" }).fill("https://example.com")
    await expect(dialog).toContainText("옴니스 안의 주소여야")
    await expect(send).toBeDisabled()
    await dialog.getByRole("textbox", { name: "써 볼 곳" }).fill("/crm")
    const preview = dialog.locator("[data-feature-done-preview]")
    await expect(preview).toContainText(`요청하신 기능이 생겼습니다 — ${marker}`)
    await expect(preview).toContainText("써 보고 불편하면 답장 주세요")
    await send.click()
    // 개발 서버는 첫 PATCH 에 라우트를 컴파일한다
    await expect(a.getByText("완료로 바꾸고 1명에게 알렸습니다")).toBeVisible({ timeout: 30_000 })
    await expect(dialog).toBeHidden()
    await expect(row).toHaveAttribute("data-status", "DONE")

    const sent = await prisma.notification.findMany({ where: { type: "feature_request_done", entityId: `${fr.id}:/crm` } })
    expect(sent.map((n) => n.userId)).toEqual([member.id])
    expect(sent[0].content).toBe("목록에서 바로 엽니다\n써 보고 불편하면 답장 주세요.")
    const log = await prisma.activityLog.findFirst({ where: { action: "feature_request.status", entityId: fr.id }, orderBy: { createdAt: "desc" } })
    expect(log?.title).toContain("요청한 사람 1명에게 알림")

    // 이미 완료인 것을 다시 보내도 두 번 가지 않는다 · 잘못된 입력은 거절
    const again = await a.request.patch(`/api/feature-requests/${fr.id}`, { data: { status: "DONE", notice: { change: "또", link: "/crm" } } })
    expect((await again.json()).notified).toBe(0)
    expect(await prisma.notification.count({ where: { type: "feature_request_done", entityId: { startsWith: fr.id } } })).toBe(1)
    expect((await a.request.patch(`/api/feature-requests/${fr.id}`, { data: { status: "REVIEW", notice: { change: "x", link: "/crm" } } })).status()).toBe(400)
    expect((await a.request.patch(`/api/feature-requests/${fr.id}`, { data: { status: "DONE", notice: { change: "x", link: "//evil.example" } } })).status()).toBe(400)
    await a.close()

    // ② 요청한 사람 — 벨에서 답장, 그리고 써 보기
    const m = await browser.newPage()
    await quiet(m)
    await quickLogin(m, "사원1")
    await m.goto("/chat")
    const bell = m.getByRole("button", { name: "알림", exact: true }).filter({ visible: true }).first()
    await bell.click()
    const item = m.locator("[data-feature-done-actions]").first()
    await expect(m.getByText(`요청하신 기능이 생겼습니다 — ${marker}`)).toBeVisible()
    await item.getByRole("button", { name: "답장" }).click()
    const reply = m.getByRole("dialog", { name: "답장" })
    await expect(reply).toContainText(marker)
    await reply.getByRole("textbox", { name: "답장 내용" }).fill("열리는데 조금 느려요")
    await reply.getByRole("button", { name: "보내기" }).click()
    await expect(m.getByText("보냈습니다")).toBeVisible({ timeout: 30_000 })
    const back = await prisma.featureRequest.findFirst({ where: { title: `[답장] ${marker}` }, include: { entries: true } })
    expect(back?.entries.map((e) => [e.requesterId, e.detail])).toEqual([[member.id, "열리는데 조금 느려요"]])

    await bell.click()
    await m.locator("[data-feature-done-actions]").first().getByRole("button", { name: "써 보기" }).click()
    await m.waitForURL("**/crm", { timeout: 30_000 })
    await m.close()

    // ③ 요청하지 않은 사람은 답장을 보낼 수 없다
    const o = await browser.newPage()
    await quickLogin(o, "사원2")
    expect((await o.request.post("/api/feedback", { data: { replyTo: fr.id, text: "x" } })).status()).toBe(404)
    expect(await prisma.notification.count({ where: { userId: other.id, type: "feature_request_done" } })).toBe(0)
    await o.close()
  } finally {
    await prisma.notification.deleteMany({ where: { type: "feature_request_done", entityId: { startsWith: fr.id } } })
    await prisma.notification.deleteMany({ where: { type: "feature_request", content: { contains: "열리는데 조금 느려요" } } })
    await prisma.featureRequest.deleteMany({ where: { OR: [{ id: fr.id }, { title: `[답장] ${marker}` }] } })
    await prisma.$disconnect()
  }
})

/**
 * UI 변경 측정 — 권한 · 내용 비수집 · 묶음 전송 · 설문 한 번 · 90일 정리. 계획: mydocs/plans/2026-11-04-ui-metrics.md
 * NEXT_PUBLIC_UI_METRICS=1 로 뜬 서버에서만 돈다(e2e-local · CI).
 */
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

const EVENTS = "/api/ui-metrics/events"
const SURVEY = "/api/ui-metrics/survey"
const SUMMARY = "/api/ui-metrics/summary"
const SHA = "feed000"
const PILL = "[data-composer-pill]"

test.skip(process.env.NEXT_PUBLIC_UI_METRICS !== "1", "사용 기록이 꺼진 빌드")
test.describe.configure({ mode: "serial" })

const prisma = new PrismaClient()
test.afterAll(async () => {
  await prisma.$disconnect()
})

const userId = async (name: string) => (await prisma.user.findFirstOrThrow({ where: { name } })).id

async function openRoom(page: Page) {
  await page.goto("/chat/default-room")
  const box = page.locator(`${PILL} textarea`).first()
  await box.waitFor({ timeout: 30_000 })
  await expect.poll(() => box.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)
  return box
}

test.describe("권한", () => {
  test("로그인하지 않으면 조회 · 기록 · 설문이 막힌다", async ({ request }) => {
    expect((await request.get(SUMMARY)).status()).toBe(401)
    expect((await request.get(SURVEY)).status()).toBe(401)
    expect((await request.post(EVENTS, { data: { sha: SHA, events: [{ name: "menu_open", path: "/" }] } })).status()).toBe(401)
  })

  test("구성원은 조회 API · 화면이 막히고, 관리자는 본다", async ({ page, browser }) => {
    await login(page, "사원1")
    expect((await page.request.get(SUMMARY)).status()).toBe(403)
    await page.goto("/settings/ui-metrics")
    await expect(page.getByText("관리자만 볼 수 있습니다")).toBeVisible()
    await expect(page.locator("[data-ui-deployment]")).toHaveCount(0)

    const ctx = await browser.newContext()
    const admin = await ctx.newPage()
    await login(admin, "팀장")
    const res = await admin.request.get(SUMMARY)
    expect(res.status()).toBe(200)
    expect(Array.isArray((await res.json()).deployments)).toBe(true)
    await ctx.close()
  })
})

test.describe("내용 비수집", () => {
  test("내용 칸이 든 요청은 거절되고 표에 아무것도 남지 않는다", async ({ page }) => {
    await login(page, "사원1")
    const secret = "내용비수집시험-비밀문구"
    const before = await prisma.uiEvent.count()
    for (const data of [
      { sha: SHA, events: [{ name: "menu_open", path: "/", content: secret }] },
      { sha: SHA, events: [{ name: secret, path: "/" }] },
      { sha: SHA, content: secret, events: [{ name: "menu_open", path: "/" }] },
      { sha: SHA, events: [{ name: "menu_open", path: "/", userId: "남의-아이디" }] },
    ]) {
      expect((await page.request.post(EVENTS, { data })).status(), JSON.stringify(data)).toBe(400)
    }
    expect(await prisma.uiEvent.count()).toBe(before)
  })

  test("서버가 경로를 다시 지우고, 사용자는 세션에서 읽는다", async ({ page }) => {
    await login(page, "사원1")
    const me = await userId("사원1")
    const res = await page.request.post(EVENTS, { data: { sha: "feed111", events: [{ name: "menu_open", path: "/tasks/고객사-비밀-업무?q=비밀" }] } })
    expect(res.status()).toBe(204)
    const rows = await prisma.uiEvent.findMany({ where: { commitSha: "feed111" } })
    expect(rows).toHaveLength(1)
    expect(rows[0].path).toBe("/tasks/:id")
    expect(rows[0].userId).toBe(me)
    await prisma.uiEvent.deleteMany({ where: { commitSha: "feed111" } })
  })

  test("글을 보내고 메뉴를 닫아도 내용 없이 묶여 탭을 숨길 때 나간다", async ({ page }) => {
    await login(page, "사원2")
    const me = await userId("사원2")
    await prisma.uiEvent.deleteMany({ where: { userId: me } })
    const secret = `비밀대화-${Date.now()}`
    // 비콘 본문은 요청 쪽에서 보이지 않아(ping) 나가는 자리에서 받아 둔다
    await page.addInitScript(() => {
      const w = window as unknown as { __beacons: string[] }
      w.__beacons = []
      const send = navigator.sendBeacon.bind(navigator)
      navigator.sendBeacon = (url, data) => {
        void (data as Blob).text().then((t) => w.__beacons.push(t))
        return send(url, data)
      }
    })
    const beacons = () => page.evaluate(() => (window as unknown as { __beacons: string[] }).__beacons)
    let posts = 0
    page.on("request", (r) => {
      if (r.method() === "POST" && new URL(r.url()).pathname.endsWith(EVENTS)) posts++
    })

    const box = await openRoom(page)
    await box.fill(secret)
    await box.press("Enter")
    await expect(page.getByText(secret).first()).toBeVisible()

    // ＋ 메뉴를 열었다가 아무것도 고르지 않고 닫는다
    await page.getByRole("button", { name: "추가", exact: true }).first().click()
    await expect(page.getByRole("menu")).toBeVisible()
    await page.keyboard.press("Escape")
    // ＋ 메뉴에서 하나를 고른다
    await page.getByRole("button", { name: "추가", exact: true }).first().click()
    await page.getByRole("menuitem", { name: /사람 언급|@/ }).first().click()
    await page.keyboard.press("Escape")
    await box.fill("")
    // 단축키
    await page.keyboard.press("ControlOrMeta+k")
    await page.keyboard.press("Escape")

    // 탭을 숨기기 전에는 나가지 않는다 — 타이머가 없다
    await page.waitForTimeout(1_000)
    expect(posts).toBe(0)

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true })
      document.dispatchEvent(new Event("visibilitychange"))
    })
    // dev 서버는 첫 글 뒤 컴파일로 잠시 멈출 수 있어 넉넉히 기다린다
    await expect.poll(() => prisma.uiEvent.count({ where: { userId: me } }), { timeout: 45_000 }).toBeGreaterThan(0)
    expect(posts).toBe(1)
    const sent = await beacons()
    expect(sent).toHaveLength(1)
    expect(sent[0]).not.toContain(secret)
    expect(sent[0]).not.toContain("default-room")

    const rows = await prisma.uiEvent.findMany({ where: { userId: me } })
    const names = rows.map((r) => r.name)
    expect(names).toEqual(expect.arrayContaining(["room_open_to_send", "plus_open", "plus_dismiss", "plus_act", "shortcut.commandPalette"]))
    expect(JSON.stringify(rows)).not.toContain(secret)
    expect(rows.every((r) => r.path === "/chat/:id")).toBe(true)
    const send = rows.find((r) => r.name === "room_open_to_send")
    expect(send?.value).toBeGreaterThan(0)
    expect(rows[0].commitSha).toBe("dev")
  })
})

test.describe("배포 다음 날 설문", () => {
  const seed = async (user: string, sha: string) => {
    const id = await userId(user)
    await prisma.uiSurveyResponse.deleteMany({ where: { userId: id } })
    await prisma.uiEvent.deleteMany({ where: { userId: id } })
    await prisma.uiEvent.create({ data: { userId: id, name: "menu_open", path: "/chat/:id", commitSha: sha, at: new Date(Date.now() - 36 * 3_600_000) } })
    return id
  }
  const cleanup = async (id: string) => {
    await prisma.uiSurveyResponse.deleteMany({ where: { userId: id } })
    await prisma.uiEvent.deleteMany({ where: { userId: id } })
  }

  test("답하면 다시 묻지 않는다 — 다른 기기(저장소가 빈 브라우저)에서도", async ({ page, browser }) => {
    const id = await seed("사원1", "feed222")
    try {
      await login(page, "사원1")
      const dialog = page.locator("[data-ui-survey]")
      await expect(dialog).toBeVisible({ timeout: 20_000 })
      await expect(dialog.getByText("이번 변경 후 하던 일이 더 쉬워졌나요?")).toBeVisible()
      await expect(dialog.getByRole("button", { name: "보내기" })).toBeDisabled()
      await dialog.getByRole("radio", { name: "4" }).click()
      await dialog.getByLabel("한 줄 의견").fill("메뉴 찾기가 쉬워졌어요")
      await dialog.getByRole("button", { name: "보내기" }).click()
      await expect(dialog).toBeHidden()
      await expect.poll(() => prisma.uiSurveyResponse.count({ where: { userId: id, commitSha: "feed222", score: 4 } })).toBe(1)

      await page.reload()
      await page.waitForTimeout(6_000)
      await expect(dialog).toBeHidden()

      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
      const phone = await ctx.newPage()
      await login(phone, "사원1")
      expect(await (await phone.request.get(SURVEY)).json()).toEqual({ sha: null })
      await phone.waitForTimeout(6_000)
      await expect(phone.locator("[data-ui-survey]")).toBeHidden()
      await ctx.close()
    } finally {
      await cleanup(id)
    }
  })

  test("닫아도 다시 묻지 않고, 폰에서도 뜨고 닫힌다", async ({ browser }) => {
    const id = await seed("사원2", "feed333")
    try {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
      const phone = await ctx.newPage()
      await login(phone, "사원2")
      const dialog = phone.locator("[data-ui-survey]")
      await expect(dialog).toBeVisible({ timeout: 20_000 })
      const size = await dialog.getByRole("radio", { name: "1" }).boundingBox()
      expect(size?.height).toBeGreaterThanOrEqual(44)
      await dialog.getByRole("button", { name: "닫기", exact: true }).first().click()
      await expect(dialog).toBeHidden()
      await expect.poll(() => prisma.uiSurveyResponse.findFirst({ where: { userId: id, commitSha: "feed333" }, select: { score: true } })).toEqual({ score: null })
      expect(await (await phone.request.get(SURVEY)).json()).toEqual({ sha: null })
      // 같은 배포에 다시 보내도 처음 것을 덮지 않는다
      await phone.request.post(SURVEY, { data: { sha: "feed333", score: 5 } })
      expect(await prisma.uiSurveyResponse.count({ where: { userId: id, commitSha: "feed333", score: null } })).toBe(1)
      await ctx.close()
    } finally {
      await cleanup(id)
    }
  })

  test("관리자가 배포별 · 사람별 중앙값과 점수를 본다", async ({ page }) => {
    const id = await userId("사원1")
    const sha = "feed444"
    await prisma.uiEvent.createMany({
      data: [1000, 3000, 8000].map((value) => ({ userId: id, name: "room_open_to_send", value, path: "/chat/:id", commitSha: sha })),
    })
    await prisma.uiSurveyResponse.create({ data: { userId: id, commitSha: sha, score: 2, comment: "어려워요" } })
    try {
      await login(page, "팀장")
      const json = await (await page.request.get(SUMMARY)).json()
      const d = json.deployments.find((x: { sha: string }) => x.sha === sha)
      expect(d.medianMs).toBe(3000)
      expect(d.medianScore).toBe(2)
      await page.goto("/settings/ui-metrics")
      const section = page.locator(`[data-ui-deployment="${sha}"]`)
      await expect(section).toContainText("3.0초")
      await expect(section).toContainText("사원1")
      await expect(section).toContainText("어려워요")
    } finally {
      await prisma.uiSurveyResponse.deleteMany({ where: { commitSha: sha } })
      await prisma.uiEvent.deleteMany({ where: { commitSha: sha } })
    }
  })
})

test("수집 안내 문구가 마이 > 시스템에 있다", async ({ page }) => {
  await login(page, "사원1")
  await page.goto("/settings")
  await page.getByRole("tab", { name: "시스템" }).click()
  const notice = page.locator("[data-ui-metrics-notice]")
  await expect(notice).toContainText("모으는 것")
  await expect(notice).toContainText("대화 내용, 파일 이름, 방 이름")
  await expect(notice).toContainText("개인 평가에 쓰지 않습니다")
  await expect(notice.getByRole("link", { name: "배포별 측정 보기" })).toHaveCount(0)
})

test("90일 지난 사용 기록만 지운다", async () => {
  const { purgeUiEvents } = await import("../../lib/ui-metrics/server")
  const id = await userId("사원3")
  const day = 86_400_000
  await prisma.uiEvent.create({ data: { userId: id, name: "menu_open", path: "/", commitSha: "feed555", at: new Date(Date.now() - 91 * day) } })
  await prisma.uiEvent.create({ data: { userId: id, name: "menu_open", path: "/", commitSha: "feed666", at: new Date(Date.now() - 89 * day) } })
  expect(await purgeUiEvents()).toBe(1)
  expect(await prisma.uiEvent.count({ where: { commitSha: "feed555" } })).toBe(0)
  expect(await prisma.uiEvent.count({ where: { commitSha: "feed666" } })).toBe(1)
  await prisma.uiEvent.deleteMany({ where: { commitSha: "feed666" } })
})

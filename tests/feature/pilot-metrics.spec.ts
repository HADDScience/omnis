/**
 * 시범 운영 측정 — 관리자만 · 서버 전용 이름 거절 · 기기 수신 기록 · 방별 직접/카톡 글 수 · 검색 묶기 · 필터.
 * 계획: mydocs/plans/2026-11-06-pilot-metrics.md. NEXT_PUBLIC_UI_METRICS=1 로 뜬 서버에서만 돈다(e2e-local · CI).
 * 넣는 글은 시험이 만든 가짜 글이고 끝나면 지운다.
 */
import { expect, test } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

const PILOT = "/api/ui-metrics/pilot"
const EVENTS = "/api/ui-metrics/events"
const ROOM = "default-room"
const SHA = "feed222"

test.skip(process.env.NEXT_PUBLIC_UI_METRICS !== "1", "사용 기록이 꺼진 빌드")
test.describe.configure({ mode: "serial" })

const prisma = new PrismaClient()
const made: string[] = []
test.afterAll(async () => {
  await prisma.chatMessage.deleteMany({ where: { id: { in: made } } })
  await prisma.uiEvent.deleteMany({ where: { commitSha: SHA } })
  await prisma.$disconnect()
})

type Week = { week: string; push: { sent: number; received: number }; messages: { direct: number; kakao: number }; searches: number; photoSearches: number }
type View = { weeks: Week[]; rooms: { roomId: string; direct: number; kakao: number }[]; people: { userId: string; weeks: number[] }[] }
const thisWeek = (v: View) => v.weeks[v.weeks.length - 1]

test("구성원은 시범 운영 칸 · API 가 막히고, 관리자는 본다", async ({ page, browser, request }) => {
  expect((await request.get(PILOT)).status()).toBe(401)
  await login(page, "사원1")
  expect((await page.request.get(PILOT)).status()).toBe(403)
  await page.goto("/settings/ui-metrics")
  await expect(page.getByText("관리자만 볼 수 있습니다")).toBeVisible()
  await expect(page.locator("[data-pilot-metrics]")).toHaveCount(0)

  const ctx = await browser.newContext()
  const admin = await ctx.newPage()
  await login(admin, "팀장")
  await admin.goto("/settings/ui-metrics")
  await expect(admin.locator("[data-pilot-metrics]")).toBeVisible()
  await expect(admin.locator("[data-pilot-week]")).toHaveCount(8)
  await ctx.close()
})

test("화면은 서버 전용 이름(발송 · 검색)을 보내지 못하고, 기기 수신 · 열기는 받는다", async ({ page }) => {
  await login(page, "사원1")
  for (const name of ["push_sent", "search_chat", "search_photo", "search_global"]) {
    expect((await page.request.post(EVENTS, { data: { sha: SHA, events: [{ name, value: 99, path: "/push" }] } })).status(), name).toBe(400)
  }
  const res = await page.request.post(EVENTS, {
    data: { sha: SHA, events: [{ name: "push_recv_s", value: 3, path: "/push" }, { name: "push_open_s", value: 40, path: "/push" }] },
  })
  expect(res.status()).toBe(204)
  const rows = await prisma.uiEvent.findMany({ where: { commitSha: SHA }, orderBy: { name: "asc" } })
  expect(rows.map((r) => [r.name, r.value])).toEqual([["push_open_s", 40], ["push_recv_s", 3]])
})

test("방 필터 — 직접 쓴 글과 카톡 이식 글을 따로 세고, 시스템 글 · 지운 글은 세지 않는다", async ({ browser }) => {
  const ctx = await browser.newContext()
  const admin = await ctx.newPage()
  await login(admin, "팀장")
  const get = async () => (await (await admin.request.get(`${PILOT}?room=${ROOM}`)).json()) as View
  const before = thisWeek(await get()).messages

  const author = await prisma.user.findFirstOrThrow({ where: { name: "사원1" } })
  const stamp = Date.now()
  const rows = await Promise.all([
    prisma.chatMessage.create({ data: { roomId: ROOM, authorId: author.id, content: "시범 측정 시험 글" } }),
    prisma.chatMessage.create({ data: { roomId: ROOM, authorId: author.id, content: "시범 측정 시험 이식 글", sourceId: `kakao:e2e-pilot-${stamp}` } }),
    prisma.chatMessage.create({ data: { roomId: ROOM, authorId: author.id, content: "지운 글", deletedAt: new Date() } }),
    prisma.chatMessage.create({ data: { roomId: ROOM, authorId: author.id, content: "__system_marker__" } }),
  ])
  made.push(...rows.map((r) => r.id))

  const after = thisWeek(await get()).messages
  expect(after.direct - before.direct).toBe(1)
  expect(after.kakao - before.kakao).toBe(1)

  // 사람 필터가 함께 걸린다 — 쓴 사람으로 고르면 그 글이 들어 있고, 그 사람의 이번 주 쓴 날이 1 이상이다
  const mine = (await (await admin.request.get(`${PILOT}?room=${ROOM}&person=${author.id}`)).json()) as View
  expect(thisWeek(mine).messages.direct).toBeGreaterThanOrEqual(1)
  expect(thisWeek(mine).messages.kakao).toBeGreaterThanOrEqual(1)
  expect(mine.people.find((p) => p.userId === author.id)?.weeks.at(-1)).toBeGreaterThanOrEqual(1)
  const lead = await prisma.user.findFirstOrThrow({ where: { name: "팀장" } })
  const theirs = (await (await admin.request.get(`${PILOT}?room=${ROOM}&person=${lead.id}`)).json()) as View
  expect(theirs.people.every((p) => p.userId === lead.id)).toBe(true)

  // 화면에서 필터를 고르면 주소에 실리고 같은 값이 보인다
  await admin.goto("/settings/ui-metrics")
  await admin.locator('[data-pilot-filter="room"]').selectOption(ROOM)
  await admin.getByRole("button", { name: "보기" }).click()
  await expect(admin).toHaveURL(new RegExp(`room=${ROOM}`))
  await expect(admin.locator("[data-pilot-week]").last().locator("[data-pilot-kakao]")).toHaveText(String(after.kakao))
  await ctx.close()
})

test("검색은 서버가 세고, 입력 중 이어 온 요청은 한 번으로 묶는다 · 검색어는 남기지 않는다", async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await login(page, "팀장")
  const me = await prisma.user.findFirstOrThrow({ where: { name: "팀장" } })
  const view = async () => thisWeek((await (await page.request.get(`${PILOT}?person=${me.id}`)).json()) as View)
  const since = new Date()
  const before = await view()

  const secret = "시범측정-검색어-비밀"
  for (const q of ["시", "시범", secret]) {
    expect((await page.request.get(`/api/chat/search?roomId=${ROOM}&q=${encodeURIComponent(q)}`)).status()).toBe(200)
  }
  await expect.poll(async () => prisma.uiEvent.count({ where: { userId: me.id, name: "search_chat", at: { gte: since } } })).toBe(3)
  const rows = await prisma.uiEvent.findMany({ where: { userId: me.id, at: { gte: since } } })
  expect(JSON.stringify(rows)).not.toContain(secret)

  const after = await view()
  expect(after.searches - before.searches).toBeLessThanOrEqual(1)
  expect(after.photoSearches - before.photoSearches).toBeLessThanOrEqual(1)
  await prisma.uiEvent.deleteMany({ where: { userId: me.id, name: { in: ["search_chat", "search_photo"] }, at: { gte: since } } })
  await ctx.close()
})

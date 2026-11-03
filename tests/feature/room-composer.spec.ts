/**
 * 메신저 입력창 하나(components/chat/room-composer.tsx) — 사람 · 전사 · 업무 · 옴니스 방이 같은 모양이고, 방마다 기능만 다르다.
 * 계획: mydocs/plans/2026-11-03-unified-composer.md
 *
 *   pnpm run test:e2e:local -- tests/feature/room-composer.spec.ts
 *
 * COMPOSER_SHOTS=<폴더> 를 주면 방마다 데스크톱 · 폰 캡처를 남긴다.
 */
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { quickLogin } from "./_setup"

const COMPANY = "/chat/default-room"
const PILL = "[data-composer-pill]"
const LIST = "[data-composer-autocomplete]"
const box = (page: Page) => page.locator(`${PILL} textarea`).first()

/** 사원1 과의 1:1 — 없으면 만든다 */
async function peopleRoom(page: Page) {
  const list = (await (await page.request.get("/api/users")).json()) as { id: string; name: string }[]
  const other = list.find((u) => u.name === "사원1")
  expect(other).toBeTruthy()
  const res = await page.request.post("/api/chat/people-rooms", { data: { userIds: [other!.id] } })
  expect(res.ok()).toBe(true)
  return `/chat/${((await res.json()) as { roomId: string }).roomId}`
}

async function taskRoom(page: Page) {
  const data = (await (await page.request.get("/api/tasks")).json()) as { id: string }[] | { tasks: { id: string }[] }
  const tasks = Array.isArray(data) ? data : data.tasks
  expect(tasks.length).toBeGreaterThan(0)
  return `/chat/task/${tasks[0].id}`
}

async function geometry(page: Page, pillSelector = PILL) {
  return page.evaluate((pill) => {
    const el = document.querySelector(pill) as HTMLElement
    const r = el.getBoundingClientRect()
    const ta = el.querySelector("textarea") as HTMLTextAreaElement
    const send = el.querySelector('button[aria-label="보내기"]') as HTMLElement
    const style = getComputedStyle(el)
    return {
      pillHeight: Math.round(r.height),
      pillRadius: style.borderTopLeftRadius,
      textSize: getComputedStyle(ta).fontSize,
      textLeft: Math.round(ta.getBoundingClientRect().left - r.left),
      sendSize: Math.round(send.getBoundingClientRect().width),
    }
  }, pillSelector)
}

for (const [label, viewport] of [
  ["데스크톱", { width: 1440, height: 900 }],
  ["폰", { width: 390, height: 844 }],
] as const) {
  test(`${label} — 사람 · 전사 · 업무 · 옴니스 방의 입력창이 같은 모양이다`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await quickLogin(page, "팀장")
    const rooms = { 전사: COMPANY, 사람: await peopleRoom(page), 업무: await taskRoom(page), 옴니스: "/chat/new" }
    const seen: Record<string, Awaited<ReturnType<typeof geometry>>> = {}
    for (const [name, url] of Object.entries(rooms)) {
      await page.goto(url)
      await box(page).waitFor({ timeout: 30_000 })
      seen[name] = await geometry(page)
      if (process.env.COMPOSER_SHOTS) {
        await page.screenshot({ path: path.join(process.env.COMPOSER_SHOTS, `${viewport.width}-${name}.png`) })
      }
    }
    expect(seen.사람).toEqual(seen.전사)
    expect(seen.업무).toEqual(seen.전사)
    // 데모에는 첨부가 없어 옴니스 방에 ＋ 가 없다 — 글자가 시작하는 자리만 다르다
    expect({ ...seen.옴니스, textLeft: 0 }).toEqual({ ...seen.전사, textLeft: 0 })
    // 화면 전체 배율(--ui-zoom)을 타므로 정확한 px 대신 메신저 크기(48px 이상)인지 본다
    expect(seen.전사.sendSize).toBeGreaterThanOrEqual(48)
    expect(seen.전사.textSize).toBe("17px")
  })
}

test("자동완성 — 전사방은 / # @ 를 받고, 옴니스 방은 그냥 글이다", async ({ page }) => {
  await quickLogin(page, "팀장")
  await page.goto(COMPANY)
  await box(page).waitFor({ timeout: 30_000 })
  await box(page).fill("/")
  await expect(page.locator(LIST)).toContainText("명령어")
  await box(page).fill("@")
  await expect(page.locator(LIST)).toContainText("사람")
  await box(page).press("Escape")
  await expect(page.locator(LIST)).toHaveCount(0)

  const agentBodies: string[] = []
  const chatPosts: string[] = []
  await page.route("**/api/agent/rooms**", async (route) => {
    if (route.request().method() === "POST") {
      agentBodies.push(route.request().postData() ?? "")
      return route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "시험" }) })
    }
    return route.continue()
  })
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname.endsWith("/api/chat/messages")) chatPosts.push(r.url())
  })
  await page.goto("/chat/new")
  await box(page).waitFor({ timeout: 30_000 })
  for (const text of ["/", "/업", "#", "@", "@사원"]) {
    await box(page).fill(text)
    await expect(page.locator(LIST)).toHaveCount(0)
  }
  // 멘션 · 명령을 쳐도 옴니스에게만 간다 — 업무 재구성을 부르는 채팅 글(/api/chat/messages)로 새지 않는다
  await box(page).fill("/업무 @사원1 #가벽 견적")
  await box(page).press("Enter")
  await expect.poll(() => agentBodies.length).toBe(1)
  expect(JSON.parse(agentBodies[0]).content).toBe("/업무 @사원1 #가벽 견적")
  expect(chatPosts).toEqual([])
  // 거절되면 글이 입력칸에 돌아온다
  await expect(box(page)).toHaveValue("/업무 @사원1 #가벽 견적")
})

test("보내는 동안 입력칸을 막지 않고 두 번 보내지 않는다, 실패하면 글이 돌아온다(업무 스레드)", async ({ page }) => {
  await quickLogin(page, "팀장")
  await page.goto(await taskRoom(page))
  await box(page).waitFor({ timeout: 30_000 })
  const text = `실패 시험 ${Date.now()}`
  let posts = 0
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  await page.route("**/api/chat/messages", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    posts++
    await gate
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "시험 실패" }) })
  })
  await box(page).fill(text)
  await box(page).press("Enter")
  await expect(box(page)).toHaveValue("")
  await expect(box(page)).toBeEnabled()
  await box(page).fill("이어 쓴 글")
  await box(page).press("Enter") // 보내는 중 — 무시되고 글이 남는다
  await expect(box(page)).toHaveValue("이어 쓴 글")
  expect(posts).toBe(1)
  release()
  await expect(box(page)).toHaveValue(`${text}\n이어 쓴 글`)
  expect(posts).toBe(1)
})

test("방을 여는 동안 쓴 글을 방 화면 입력창이 이어받고, 입력창 자리가 밀리지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await quickLogin(page, "팀장")
  await page.goto("/chat")
  // 방 화면이 늦게 오게 해 입장 화면을 붙잡아 둔다
  await page.route(`**${COMPANY}**`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_500))
    await route.continue()
  })
  await page.locator(`a[href$="${COMPANY}"]`).first().click()
  const entry = page.locator("[data-entry-composer]")
  await entry.waitFor({ timeout: 15_000 })
  await entry.fill("방이 오기 전에 쓴 글")
  // /chat 가운데 칸의 새 대화 입력창이 덮개 아래 남아 있다 — 입장 입력창의 알약을 집어 잰다
  const before = await geometry(page, `${PILL}:has([data-entry-composer])`)
  await expect(entry).toHaveCount(0, { timeout: 30_000 })
  await expect(box(page)).toHaveValue("방이 오기 전에 쓴 글")
  expect(await geometry(page)).toEqual(before)
})

test("오른쪽 패널에서도 같은 입력창으로 보낸다", async ({ page }) => {
  await quickLogin(page, "팀장")
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/tasks")
  await page.getByRole("button", { name: /^대화 패널 열기/ }).click()
  const input = page.getByPlaceholder("메시지 입력...  / 명령 · @ 사람 · # 업무")
  await expect(input).toBeVisible()
  const panelGeometry = await geometry(page)
  // 패널은 메신저 밖 — 작은 크기
  expect(panelGeometry.sendSize).toBeLessThan(40)
  if (process.env.COMPOSER_SHOTS) {
    await page.waitForTimeout(800) // 패널이 다 열린 뒤
    await page.screenshot({ path: path.join(process.env.COMPOSER_SHOTS, "1440-패널.png") })
  }
  const text = `패널 글 ${Date.now()}`
  await input.fill(text)
  await page.getByRole("button", { name: "보내기" }).last().click()
  await expect(input).toHaveValue("")
  await expect(page.getByText(text).first()).toBeVisible()
})

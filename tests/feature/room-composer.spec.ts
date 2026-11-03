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
/** React 가 붙은 뒤에 쓴다 — 빌드한 서버는 그 전에 칠 만큼 빨리 입력칸을 보여 준다 */
const hydrated = (page: Page) =>
  expect.poll(() => box(page).evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)

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

test("보내는 동안 다음 글을 보내도 쓴 순서대로 닿고, 실패한 글만 돌아온다(업무 스레드)", async ({ page }) => {
  await quickLogin(page, "팀장")
  await page.goto(await taskRoom(page))
  await box(page).waitFor({ timeout: 30_000 })
  await hydrated(page)
  const first = `첫 글 ${Date.now()}`
  const second = `둘째 글 ${Date.now()}`
  const posts: string[] = []
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  await page.route("**/api/chat/messages", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    const { content } = JSON.parse(route.request().postData() ?? "{}") as { content: string }
    posts.push(content)
    if (content === first) {
      await gate
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "시험 실패" }) })
    }
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: `m-${Date.now()}` }) })
  })
  await box(page).fill(first)
  await box(page).press("Enter")
  await expect(box(page)).toHaveValue("")
  await expect(box(page)).toBeEnabled()
  await box(page).fill(second)
  await box(page).press("Enter")
  await expect(box(page)).toHaveValue("")
  // 앞 글이 끝나기 전에는 뒤 글이 서버로 가지 않는다 — 두 글 다 「보내는 중」 으로 보인다
  await expect(page.getByText("보내는 중…")).toHaveCount(2)
  expect(posts).toEqual([first])
  await box(page).fill("이어 쓴 글")
  release()
  await expect.poll(() => posts).toEqual([first, second])
  await expect(page.getByText("시험 실패").first()).toBeVisible()
  // 실패한 첫 글만 입력칸 맨 앞으로 돌아오고, 그 사이 쓴 글은 뒤에 남는다
  await expect(box(page)).toHaveValue(`${first}\n이어 쓴 글`)
})

test("같은 순간 두 번 눌러도 한 번만 보내고, 실패한 글은 말풍선에 표시되며 뒤 글을 막지 않는다(전사방)", async ({ page }) => {
  await quickLogin(page, "팀장")
  await page.goto(COMPANY)
  await box(page).waitFor({ timeout: 30_000 })
  await hydrated(page)
  const failing = `실패할 글 ${Date.now()}`
  const next = `뒤 글 ${Date.now()}`
  const posts: string[] = []
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  await page.route("**/api/chat/messages", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    const { content } = JSON.parse(route.request().postData() ?? "{}") as { content: string }
    posts.push(content)
    if (content !== failing) return route.continue()
    await gate
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "시험 실패" }) })
  })
  await box(page).fill(failing)
  await page.evaluate(() => {
    const send = document.querySelector('[data-composer-pill] button[aria-label="보내기"]') as HTMLButtonElement
    send.click()
    send.click()
  })
  await expect(box(page)).toHaveValue("")
  await box(page).fill(next)
  await box(page).press("Enter")
  await expect(page.getByText(next).first()).toBeVisible()
  expect(posts).toEqual([failing])
  release()
  await expect.poll(() => posts).toEqual([failing, next])
  await expect(page.getByText("시험 실패").first()).toBeVisible()
  // 화면에서도 쓴 순서 그대로다
  const order = await page.evaluate(([a, b]) => {
    const text = document.body.innerText
    return text.lastIndexOf(a) < text.lastIndexOf(b)
  }, [failing, next])
  expect(order).toBe(true)
})

async function roomUrls(page: Page) {
  return { 전사: COMPANY, 사람: await peopleRoom(page), 업무: await taskRoom(page), 옴니스: "/chat/new" }
}

/** 옴니스 방은 모델을 부르지 않게 거절로 끝낸다 — 입력창이 포커스를 지키는지만 본다 */
async function refuseAgent(page: Page) {
  await page.route("**/api/agent/rooms**", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    return route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "시험" }) })
  })
}

const focused = (page: Page) => box(page).evaluate((el) => document.activeElement === el)

test("데스크톱 — 보낸 뒤 입력칸에 그대로 있다(네 방 공통, Enter · 단추)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await quickLogin(page, "팀장")
  await refuseAgent(page)
  for (const [name, url] of Object.entries(await roomUrls(page))) {
    await page.goto(url)
    await box(page).waitFor({ timeout: 30_000 })
    await hydrated(page)
    await box(page).fill(`포커스 시험 Enter ${name} ${Date.now()}`)
    await box(page).press("Enter")
    await expect.poll(() => focused(page), `${name} Enter`).toBe(true)
    await box(page).fill(`포커스 시험 단추 ${name} ${Date.now()}`)
    await page.locator(`${PILL} button[aria-label="보내기"]`).first().click()
    await expect.poll(() => focused(page), `${name} 단추`).toBe(true)
  }
})

test.describe("폰", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("쓰던 중 단추를 누르면 입력칸에 남고, 내려 둔 키보드는 올리지 않는다(네 방 공통)", async ({ page }) => {
    await quickLogin(page, "팀장")
    await refuseAgent(page)
    for (const [name, url] of Object.entries(await roomUrls(page))) {
      await page.goto(url)
      await box(page).waitFor({ timeout: 30_000 })
      await hydrated(page)
      expect(await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches)).toBe(true)
      const send = page.locator(`${PILL} button[aria-label="보내기"]`).first()
      await box(page).tap()
      await box(page).fill(`폰 쓰던 중 ${name} ${Date.now()}`)
      await send.tap()
      await page.waitForTimeout(300)
      expect(await focused(page), `${name} 쓰던 중`).toBe(true)
      // 옴니스 방은 답이 끝나야 단추가 돌아온다
      await box(page).fill(`폰 키보드 내림 ${name} ${Date.now()}`)
      await box(page).evaluate((el) => (el as HTMLTextAreaElement).blur())
      await expect.poll(() => send.isEnabled()).toBe(true)
      await send.tap()
      await page.waitForTimeout(300)
      expect(await focused(page), `${name} 내려 둔 키보드`).toBe(false)
    }
  })

  test("폰의 Enter 는 줄바꿈이다", async ({ page }) => {
    await quickLogin(page, "팀장")
    await page.goto(COMPANY)
    await box(page).waitFor({ timeout: 30_000 })
    await box(page).tap()
    await box(page).fill("한 줄")
    await box(page).press("Enter")
    await expect(box(page)).toHaveValue(/한 줄/)
  })
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

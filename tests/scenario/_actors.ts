import { type Browser, type BrowserContext, type Page, expect } from "@playwright/test"
import { existsSync, readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

/**
 * 시나리오 테스트의 '사람'.
 *
 * 한 Playwright 테스트 안에서 브라우저 컨텍스트를 사람 수만큼 만든다. 컨텍스트마다
 * 세션 쿠키가 따로라 4명이 동시에 로그인해 있고, 각자의 화면이 3초 폴링·알림 폴링을
 * 계속 돌린다. 목킹은 없다 — 화면이 부르는 API 를 화면이 부르고, Gemini 도 실제로 부른다.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 이름 → 비밀번호. 저장소에 올리지 않는 로컬 파일이나 E2E_ACCOUNTS(JSON) 환경변수에서 읽는다. */
export function loadAccounts(): Record<string, string> {
  if (process.env.E2E_ACCOUNTS) return JSON.parse(process.env.E2E_ACCOUNTS)
  const file = process.env.E2E_ACCOUNTS_FILE ?? path.join(__dirname, "accounts.local.json")
  if (!existsSync(file)) {
    throw new Error(
      `계정 파일이 없습니다: ${file}\n{"이름": "비밀번호", ...} 형식으로 만들거나 E2E_ACCOUNTS 환경변수로 주세요.`,
    )
  }
  return JSON.parse(readFileSync(file, "utf-8"))
}

export interface Actor {
  name: string
  context: BrowserContext
  page: Page
}

export async function createActor(browser: Browser, name: string, password: string): Promise<Actor> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto("/login")
  await page.getByRole("textbox", { name: "이름" }).fill(name)
  await page.getByRole("textbox", { name: "비밀번호" }).fill(password)
  await page.getByRole("button", { name: "로그인", exact: true }).click()
  try {
    await page.waitForURL("**/dashboard", { timeout: 20_000 })
  } catch {
    throw new Error(`${name} 로그인 실패 — accounts.local.json 의 비밀번호가 이 DB 와 다르다`)
  }
  return { name, context, page }
}

// ─── 우측 패널 (채팅 · 업무 스레드) ─────────────────────────────

/** 헤더 버튼으로 패널을 연다. 이미 열려 있으면 그대로. */
export async function openPanel(page: Page) {
  const closeBtn = page.getByRole("button", { name: "패널 닫기" }).first()
  const header = page.locator("header")
  const trigger = header.getByRole("button", { name: /채팅 열기|스레드 열기/ })
  if (await trigger.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await trigger.click()
  }
  await expect(closeBtn).toBeVisible({ timeout: 5_000 })
}

/** 패널을 닫는다. 패널이 헤더 오른쪽(알림 벨)을 덮으므로 벨을 누르기 전에 닫아야 한다. */
export async function closePanel(page: Page) {
  const btn = page.locator("aside").getByRole("button", { name: "패널 닫기" })
  if (await btn.isVisible().catch(() => false)) {
    await btn.click()
    await expect(btn).toBeHidden({ timeout: 5_000 })
  }
}

/** 패널의 「전체」 채팅 탭. */
export async function openAllChat(page: Page) {
  await openPanel(page)
  // 「전체」 는 대시보드 필터·최근 스레드 필터에도 있다. 패널(aside) 안 첫 번째가 탭이다.
  await page.locator("aside").getByRole("button", { name: "전체", exact: true }).first().click()
  await chatBox(page).waitFor({ state: "visible", timeout: 8_000 })
}

export function chatBox(page: Page) {
  return page.getByRole("textbox", { name: /메시지 입력/ }).first()
}

/** 전체 채팅에 한 줄 보내고, 내 화면에 그 글이 뜰 때까지 기다린다. */
export async function say(page: Page, text: string) {
  await openAllChat(page)
  await chatBox(page).fill(text)
  await page.keyboard.press("Enter")
  await expect(page.locator("aside").getByText(text, { exact: false }).first()).toBeVisible({ timeout: 15_000 })
}

/** 다른 사람이 보낸 글이 폴링으로 내 채팅에 도착할 때까지 기다린다. */
export async function waitForChat(page: Page, text: string, timeout = 30_000) {
  await openAllChat(page)
  await expect(page.locator("aside").getByText(text, { exact: false }).first()).toBeVisible({ timeout })
}

// ─── 업무 등록 (/업무 명령 → 모달) ──────────────────────────────

export interface TaskRef {
  id: string
  name: string
  slug: string
}

interface ApiTask {
  id: string
  name: string
  slug: string
  status: string
  assignees: { user: { id: string; name: string } }[]
  instructor: { id: string; name: string }
}

/** 화면이 쓰는 같은 API 로 업무 목록을 읽는다 (검증용). */
export async function listTasks(page: Page): Promise<ApiTask[]> {
  return page.evaluate(async () => {
    const res = await fetch("/api/tasks")
    return res.json()
  })
}

/**
 * `/업무 @담당자 제목` 을 채팅창에 치고 모달에서 AI 자동완성 → 업무 등록.
 * AI 가 제목을 다듬을 수 있으므로 등록 전후 목록을 비교해 새 업무를 찾는다.
 */
export async function createTaskByCommand(
  page: Page,
  opts: { assignee: string; title: string; ai?: boolean; tag?: string },
): Promise<TaskRef> {
  const before = new Set((await listTasks(page)).map((t) => t.id))

  await openAllChat(page)
  await chatBox(page).fill(`/업무 @${opts.assignee} ${opts.title}`)
  await page.keyboard.press("Enter")

  const dialog = page.getByRole("dialog", { name: "업무 등록" })
  await expect(dialog).toBeVisible({ timeout: 10_000 })

  // 담당자 칩이 @멘션으로 이미 눌려 있어야 한다. 아니면 직접 누른다.
  const group = dialog.getByRole("group", { name: "담당자 선택" })
  // 칩의 접근성 이름은 "김 김아리"(아바타 이니셜 + 이름) 이라 끝만 맞춘다
  const chip = group.getByRole("button", { name: new RegExp(`${opts.assignee}$`) })
  await expect(chip).toBeVisible({ timeout: 10_000 })
  if ((await chip.getAttribute("aria-pressed")) !== "true") await chip.click()
  await expect(chip).toHaveAttribute("aria-pressed", "true")

  if (opts.ai !== false) {
    const aiBtn = dialog.getByRole("button", { name: "AI 자동완성" })
    await aiBtn.click()
    // 호출 중엔 버튼이 잠긴다. 다시 풀리면 끝(성공·실패 모두). 실패면 사람이 친 제목으로 그냥 등록한다.
    await expect(aiBtn).toBeDisabled({ timeout: 5_000 })
    await expect(aiBtn).toBeEnabled({ timeout: 90_000 })
  }

  const titleBox = dialog.getByRole("textbox", { name: /제목/ })
  await expect(titleBox).not.toHaveValue("")
  // AI 가 제목을 다듬으면서 실행 태그를 지운다. 사람이 제목을 손보듯 태그를 앞에 되돌려 놓는다 —
  // 이전 실행의 같은 이름 업무·알림과 섞이지 않게.
  if (opts.tag) {
    const now = await titleBox.inputValue()
    if (!now.includes(opts.tag)) await titleBox.fill(`[${opts.tag}] ${now}`)
  }
  await dialog.getByRole("button", { name: "업무 등록", exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })

  let created: ApiTask | undefined
  await expect
    .poll(
      async () => {
        const tasks = await listTasks(page)
        created = tasks.find(
          (t) => !before.has(t.id) && t.assignees.some((a) => a.user.name === opts.assignee),
        )
        return created?.id ?? null
      },
      { timeout: 15_000, message: `새 업무(담당 ${opts.assignee})를 목록에서 찾지 못함` },
    )
    .not.toBeNull()
  return { id: created!.id, name: created!.name, slug: created!.slug }
}

// ─── 알림 벨 ─────────────────────────────────────────────────────

function bellPopover(page: Page) {
  return page.locator('[data-slot="popover-content"]').filter({ hasText: "알림" })
}

async function openBell(page: Page) {
  const pop = bellPopover(page)
  if (await pop.isVisible().catch(() => false)) return pop
  await closePanel(page)
  // 새 알림 토스트가 우상단에서 벨을 몇 초 덮는다. 마우스 대신 키보드로 연다.
  const bell = page.getByRole("button", { name: "알림", exact: true })
  await bell.focus()
  await page.keyboard.press("Enter")
  await expect(pop).toBeVisible({ timeout: 5_000 })
  return pop
}

async function closeBell(page: Page) {
  if (await bellPopover(page).isVisible().catch(() => false)) {
    await page.keyboard.press("Escape")
    await expect(bellPopover(page)).toBeHidden({ timeout: 3_000 })
  }
}

/**
 * 제목이 `title` 로 시작하는 알림이 벨에 도착할 때까지 기다린다.
 * 벨은 2.5초마다 폴링하므로, 닫았다 여는 것으로 새 목록을 본다.
 */
export async function waitForNotification(page: Page, title: string, timeout = 90_000) {
  const deadline = Date.now() + timeout
  while (true) {
    const pop = await openBell(page)
    const item = pop.getByText(title, { exact: false }).first()
    if (await item.isVisible().catch(() => false)) return
    await closeBell(page)
    if (Date.now() > deadline) throw new Error(`${page.url()} — 알림 「${title}」 이(가) ${timeout / 1000}초 안에 오지 않음`)
    await page.waitForTimeout(3_000)
  }
}

/** 알림 하나(제목으로 찾음)의 액션 버튼을 누른다. 예: 「수락」, 「완료로 표시」 */
export async function respondNotification(page: Page, title: string, button: string, timeout = 90_000) {
  await waitForNotification(page, title, timeout)
  const pop = await openBell(page)
  // 알림 한 건 = px-3 py-2.5 블록. 제목과 버튼을 같이 가진 블록을 고른다.
  const items = pop
    .locator("div.px-3")
    .filter({ hasText: title })
    .filter({ has: page.getByRole("button", { name: button, exact: true }) })
  const before = await items.count()
  expect(before, `「${title}」 에 「${button}」 버튼이 있는 알림`).toBeGreaterThan(0)
  await items.first().getByRole("button", { name: button, exact: true }).click()
  // 응답한 알림에서 버튼이 사라진다 (같은 제목이 여럿이면 하나 줄어든다)
  await expect(items).toHaveCount(before - 1, { timeout: 10_000 })
  await closeBell(page)
}

// ─── 업무 상세 · 스레드 ──────────────────────────────────────────

export async function gotoTask(page: Page, task: TaskRef) {
  await page.goto(`/tasks/${task.id}`)
  // 업무명은 AI 재구성이 바꿀 수 있어 제목 대신 상태 셀렉트(상세에만 있다)로 도착을 확인한다
  await expect(page.getByRole("combobox").first()).toBeVisible({ timeout: 15_000 })
}

/** 업무 상세의 「이 업무」 스레드에 답장한다. API 는 AI 재구성이 끝난 뒤 응답하므로 전송 종료 = AI 종료. */
export async function replyInThread(page: Page, task: TaskRef, text: string) {
  await gotoTask(page, task)
  await openPanel(page)
  await page.locator("aside").getByRole("button", { name: "이 업무", exact: true }).click()
  const box = page.getByRole("textbox", { name: "이 업무 스레드에 답장" })
  await box.waitFor({ state: "visible", timeout: 8_000 })
  await box.fill(text)
  await page.keyboard.press("ControlOrMeta+Enter")
  // 서버는 Gemini 재구성이 끝난 뒤 응답하고, 화면은 그때 입력창을 비우고 새로고침한다.
  await expect(box).toHaveValue("", { timeout: 120_000 })
  await expect(page.locator("aside").getByText(text, { exact: false }).first()).toBeVisible({ timeout: 20_000 })
}

/** 업무 상세 상단의 상태 셀렉트가 `label` 이 될 때까지 (새로고침하며) 기다린다. */
export async function waitForTaskStatus(page: Page, task: TaskRef, label: string, timeout = 60_000) {
  const deadline = Date.now() + timeout
  while (true) {
    await gotoTask(page, task)
    const status = page.getByRole("combobox").filter({ hasText: new RegExp(`^${label}$`) }).first()
    if (await status.isVisible({ timeout: 2_000 }).catch(() => false)) return
    if (Date.now() > deadline) throw new Error(`업무 「${task.name}」 상태가 ${timeout / 1000}초 안에 「${label}」 이 되지 않음`)
    await page.waitForTimeout(3_000)
  }
}

/** 스레드에 다른 사람이 쓴 글이 보이는지 (새로고침해서) 확인한다. */
export async function expectThreadHas(page: Page, task: TaskRef, text: string) {
  await gotoTask(page, task)
  await openPanel(page)
  await page.locator("aside").getByRole("button", { name: "이 업무", exact: true }).click()
  await expect(page.locator("aside").getByText(text, { exact: false }).first()).toBeVisible({ timeout: 15_000 })
}

/**
 * 완료 확인 알림(AI 가 "완료" 로 읽었을 때 온다)에 「완료로 표시」 를 누른다.
 * AI 가 진행 보고로 읽어 알림이 안 오면, 사람이 하듯 업무 상세의 「업무 완료」 버튼을 누른다.
 * 어느 길로 갔는지 돌려준다 — 리포트에 남겨야 AI 판정 품질이 보인다.
 */
export async function markDone(
  page: Page,
  task: TaskRef,
  timeout = 60_000,
): Promise<{ how: "ai-confirm" | "manual-button"; why?: string }> {
  try {
    // 업무명은 AI 재구성이 바꿀 수 있어 제목 대신 본문의 #슬러그로 찾는다
    await respondNotification(page, `#${task.slug} 업무를 완료로 표시할까요?`, "완료로 표시", timeout)
    return { how: "ai-confirm" }
  } catch (e) {
    const why = e instanceof Error ? e.message.replace(/\s+/g, " ").slice(0, 400) : String(e)
    await gotoTask(page, task)
    const done = page.waitForResponse((r) => r.url().includes(`/api/tasks/${task.id}`) && r.request().method() === "PATCH")
    await page.getByRole("button", { name: "업무 완료", exact: true }).click()
    expect((await done).ok()).toBe(true)
    return { how: "manual-button", why }
  }
}

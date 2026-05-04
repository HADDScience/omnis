import { type Page, expect } from "@playwright/test"
import { readFileSync } from "fs"

// ─── CSV 파서 ────────────────────────────────────────────

export interface TestRow {
  test_id: string
  scenario_type: string
  sender: string
  receiver: string
  chat_message: string
  task_name: string
  task_status: string
  project_name: string
  category: string
  priority: string
  checklist_items: string
  file_path: string
  expected_action: string
}

export function loadTestData(csvPath: string): TestRow[] {
  const raw = readFileSync(csvPath, "utf-8")
  const lines = raw.split("\n").filter((l) => l.trim())
  const headers = parseCSVLine(lines[0])
  return lines.slice(1).map((line) => {
    const vals = parseCSVLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = vals[i] ?? "" })
    return row as unknown as TestRow
  })
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current)
      current = ""
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

// ─── 로그인 ──────────────────────────────────────────────

export async function login(page: Page, name: string, password = process.env.E2E_PASSWORD ?? "changeme") {
  await page.goto("/login")
  await page.getByRole("textbox", { name: "이름" }).fill(name)
  await page.getByRole("textbox", { name: "비밀번호" }).fill(password)
  await page.getByRole("button", { name: "로그인" }).click()
  await page.waitForURL("**/dashboard", { timeout: 15_000 })
}

// ─── 채팅 패널 ──────────────────────────────────────────

export function chatDock(page: Page) {
  return page.locator('[data-testid="chat-dock"]')
}

export async function ensureChatOpen(page: Page) {
  const dock = chatDock(page)
  await dock.waitFor({ state: "attached", timeout: 5_000 })
  const state = await dock.getAttribute("data-state")
  if (state !== "open") {
    const openBtn = dock.locator('button[title="열기"]').first()
    if (await openBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await openBtn.click()
    } else {
      // 구형 FAB 호환 (혹시 잔존)
      const fab = page.locator("button.fixed.bottom-5.right-5")
      if (await fab.isVisible({ timeout: 1000 }).catch(() => false)) {
        await fab.click()
      }
    }
    await page.waitForTimeout(400)
  }
  await dock.locator("textarea").first().waitFor({ state: "visible", timeout: 8_000 })
}

export async function sendChatMessage(page: Page, message: string) {
  await ensureChatOpen(page)
  const textarea = chatDock(page).locator("textarea").first()
  await textarea.fill(message)
  await page.keyboard.press("Enter")
  await page.waitForTimeout(1500)
}

export async function sendChatMessageWithFile(page: Page, message: string, filePath: string) {
  await ensureChatOpen(page)
  const dock = chatDock(page)

  // 파일 첨부
  const fileInput = dock.locator('input[type="file"]').first()
  await fileInput.setInputFiles(filePath)
  await page.waitForTimeout(1500)

  // 메시지 입력 + 전송
  if (message) {
    const textarea = dock.locator("textarea").first()
    await textarea.fill(message)
  }
  await page.keyboard.press("Enter")
  await page.waitForTimeout(2000)
}

// ─── 업무 지시 플로우 ────────────────────────────────────

export async function startTaskInstruction(page: Page) {
  await ensureChatOpen(page)
  const btn = chatDock(page).getByRole("button", { name: "업무 지시" })
  await btn.click()
  await page.waitForTimeout(500)
}

export async function selectMessages(page: Page, count: number) {
  const dock = chatDock(page)
  const checkboxes = dock.locator("[data-slot='checkbox']")
  await checkboxes.first().waitFor({ state: "visible", timeout: 5_000 })
  const total = await checkboxes.count()
  let selected = 0
  for (let i = total - 1; i >= 0 && selected < count; i--) {
    const messageRow = checkboxes
      .nth(i)
      .locator("xpath=ancestor::div[contains(@class, 'cursor-pointer')][1]")
    await messageRow.click()
    await page.waitForTimeout(300)
    selected++
  }
}

export async function selectAssignee(page: Page, assigneeName: string) {
  const trigger = chatDock(page).locator("[data-slot='select-trigger']").first()
  await trigger.click()
  await page.waitForTimeout(500)

  const option = page.locator("[data-slot='select-item']").filter({ hasText: assigneeName })
  await option.waitFor({ state: "visible", timeout: 5_000 })
  await option.click()
  await page.waitForTimeout(500)
}

export async function completeTaskInstruction(page: Page) {
  const completeBtn = chatDock(page).getByRole("button", { name: "완료" })
  await expect(completeBtn).toBeEnabled({ timeout: 10_000 })
  await completeBtn.click()

  // Gemini 구조화 대기 → TaskInstructionDialog의 "업무 생성" 버튼
  // 다이얼로그는 채팅 패널 밖에 나타남
  const dialog = page.locator("[role='dialog'], [data-slot='dialog-content']")
  await dialog.waitFor({ state: "visible", timeout: 5_000 })

  const createBtn = dialog.getByRole("button", { name: "업무 생성" })
  await createBtn.waitFor({ state: "visible", timeout: 30_000 })
  await page.waitForTimeout(500)
  await createBtn.click()
  await page.waitForTimeout(2000)
}

// ─── 업무 상태 변경 ──────────────────────────────────────

export async function navigateToTasks(page: Page) {
  await page.getByRole("link", { name: "내 업무" }).click()
  await page.waitForURL("**/tasks", { timeout: 10_000 })
}

export async function openTask(page: Page, taskName: string) {
  const link = page.getByRole("link", { name: taskName }).first()
  await link.click()
  await page.waitForURL("**/tasks/**", { timeout: 10_000 })
}

export async function changeTaskStatus(page: Page, status: string) {
  const statusLabels: Record<string, string> = {
    TODO: "시작 전",
    IN_PROGRESS: "진행 중",
    PAUSED: "대기",
    DELAYED: "지연 중",
    DONE: "완료",
    CANCELLED: "중단",
  }
  const label = statusLabels[status] ?? status

  // 상태 Select 트리거 클릭
  const trigger = page.locator("[data-slot='select-trigger']").first()
  await trigger.click()
  await page.waitForTimeout(300)

  const option = page.locator("[data-slot='select-item']").filter({ hasText: label })
  await option.click()
  await page.waitForTimeout(1000)
}

// ─── 업무 API 직접 생성 ─────────────────────────────────

export async function createTaskViaAPI(
  page: Page,
  opts: { name: string; ownerId?: string; ownerName?: string; checklist?: string[]; projectId?: string; productId?: string }
) {
  // API로 유저 목록을 조회하여 ownerId 찾기
  let ownerId = opts.ownerId
  if (!ownerId && opts.ownerName) {
    const usersRes = await page.evaluate(async (name) => {
      const res = await fetch("/api/users")
      const users = await res.json()
      const user = users.find((u: { name: string }) => u.name === name)
      return user?.id ?? null
    }, opts.ownerName)
    ownerId = usersRes as string
  }

  const taskRes = await page.evaluate(async (body) => {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    return res.ok
  }, {
    name: opts.name,
    ownerId: ownerId ?? "",
    projectId: opts.projectId ?? null,
    productId: opts.productId ?? null,
    checklists: opts.checklist?.map((name) => ({ name })) ?? [],
  })

  return taskRes
}

/** 첫 번째 프로젝트 ID를 반환 (워크스페이스 테스트용) */
export async function getFirstProjectId(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const res = await fetch("/api/projects")
    const projects = await res.json()
    return projects[0]?.id ?? null
  })
}

/** 첫 번째 제품 ID를 반환 (워크스페이스 테스트용) */
export async function getFirstProductId(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const res = await fetch("/api/products")
    const products = await res.json()
    return products[0]?.id ?? null
  })
}

// ─── Slug 조회 + 메시지 치환 ─────────────────────────────

export async function getTaskSlug(page: Page, taskName: string): Promise<string> {
  const slug = await page.evaluate(async (name) => {
    const res = await fetch("/api/tasks")
    const tasks = await res.json()
    const task = tasks.find((t: { name: string }) => t.name === name)
    return task?.slug ?? ""
  }, taskName)
  return slug as string
}

export function resolveSlug(message: string, slug: string): string {
  return message.replace(/\#\{task_slug\}/g, `#${slug}`)
}

// ─── 검증 ────────────────────────────────────────────────

export async function verifyTaskExists(page: Page, taskName: string) {
  await navigateToTasks(page)
  await expect(page.locator("body")).toContainText(taskName, { timeout: 10_000 })
}

export async function verifyTaskStatus(page: Page, expectedStatus: string) {
  const statusLabels: Record<string, string> = {
    TODO: "시작 전",
    IN_PROGRESS: "진행 중",
    DONE: "완료",
  }
  const label = statusLabels[expectedStatus] ?? expectedStatus
  await expect(page.locator("[data-slot='select-value']").first()).toContainText(label, { timeout: 5_000 })
}

// ─── DONE 처리 헬퍼 ──────────────────────────────────────

/** 업무 현재 상태 조회 */
export async function getTaskStatus(page: Page, taskName: string): Promise<string> {
  return page.evaluate(async (name) => {
    const res = await fetch("/api/tasks")
    const tasks = await res.json()
    return tasks.find((t: { name: string }) => t.name === name)?.status ?? ""
  }, taskName) as Promise<string>
}

/** 현재 업무 ID 목록 스냅샷 */
export async function getTaskIdSnapshot(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const res = await fetch("/api/tasks")
    const tasks = await res.json()
    return tasks.map((t: { id: string }) => t.id)
  }) as Promise<string[]>
}

/** 스냅샷 비교로 새로 생긴 업무 이름 반환 */
export async function findNewTaskName(page: Page, beforeIds: string[]): Promise<string> {
  await page.waitForTimeout(2000)
  return page.evaluate(async (ids) => {
    const res = await fetch("/api/tasks")
    const tasks = await res.json()
    const newTask = tasks.find((t: { id: string }) => !ids.includes(t.id))
    return newTask?.name ?? ""
  }, beforeIds) as Promise<string>
}

/** 업무를 API로 직접 DONE 처리 */
export async function markTaskDoneViaAPI(page: Page, taskName: string): Promise<boolean> {
  const taskId = await page.evaluate(async (name) => {
    const res = await fetch("/api/tasks")
    const tasks = await res.json()
    return tasks.find((t: { name: string }) => t.name === name)?.id ?? ""
  }, taskName) as string
  if (!taskId) return false
  await page.evaluate(async (id) => {
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "DONE" }),
    })
  }, taskId)
  return true
}

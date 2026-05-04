import { test, expect } from "@playwright/test"
import path from "path"
import { existsSync } from "fs"
import { fileURLToPath } from "url"
import {
  loadTestData,
  login,
  sendChatMessage,
  sendChatMessageWithFile,
  ensureChatOpen,
  startTaskInstruction,
  selectMessages,
  selectAssignee,
  completeTaskInstruction,
  navigateToTasks,
  getTaskSlug,
  resolveSlug,
  changeTaskStatus,
  createTaskViaAPI,
  getFirstProductId,
  getTaskIdSnapshot,
  findNewTaskName,
  getTaskStatus,
  markTaskDoneViaAPI,
  type TestRow,
} from "./helpers"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const CSV_PATH = path.join(__dirname, "e2e-test-data.csv")
const testData = loadTestData(CSV_PATH)

const senderMap: Record<string, string> = {
  "김아리": "김아리",
  "노혜린": "노혜린",
  "정우창": "정우창",
  "박소정": "박소정",
  "주용석": "주용석",
  "허채정": "김아리",
}

// ─── 완료 메시지 전송 헬퍼 ──────────────────────────────
// Gemini rebuildTask가 "complete" action으로 분류하게끔
// "이 업무 완전히 끝났습니다" 패턴을 사용

async function sendCompleteMessage(
  page: import("@playwright/test").Page,
  slug: string,
  senderLogin: string,
  currentLogin: string,
  customMsg?: string
) {
  if (senderLogin !== currentLogin) {
    await page.goto("/login")
    await login(page, senderLogin)
  }
  await ensureChatOpen(page)
  const msg = customMsg ?? `#${slug} 이 업무 완전히 끝났습니다.`
  await sendChatMessage(page, msg)
  // Gemini rebuildTask 처리 대기 (polling 3초 × 4회)
  await page.waitForTimeout(12_000)
}

// ─── 1. 로그인 ────────────────────────────────────────────

test.describe("로그인", () => {
  test("정상 로그인 → 대시보드 이동", async ({ page }) => {
    await login(page, "정우창")
    await expect(page).toHaveURL(/dashboard/)
  })

  test("잘못된 비밀번호 → 에러 메시지", async ({ page }) => {
    await page.goto("/login")
    await page.getByRole("textbox", { name: "이름" }).fill("정우창")
    await page.getByRole("textbox", { name: "비밀번호" }).fill("wrong")
    await page.getByRole("button", { name: "로그인" }).click()
    await expect(page.locator("text=올바르지 않습니다")).toBeVisible({ timeout: 5_000 })
  })
})

// ─── 2. 채팅 메시지 전송 ─────────────────────────────────

test.describe("채팅 메시지", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "김아리")
  })

  test("텍스트 메시지 전송", async ({ page }) => {
    const msg = `테스트 메시지 ${Date.now()}`
    await sendChatMessage(page, msg)
    await expect(page.locator(`text=${msg}`)).toBeVisible({ timeout: 10_000 })
  })

  test("파일 첨부 메시지 전송", async ({ page }) => {
    const fileRow = testData.find((r) => r.file_path && r.scenario_type === "file_share")
    if (!fileRow || !existsSync(fileRow.file_path)) { test.skip(); return }
    await sendChatMessageWithFile(page, fileRow.chat_message, fileRow.file_path)
    await page.waitForTimeout(3000)
  })
})

// ─── 3. 업무 지시 (채팅) ─────────────────────────────────

test.describe("업무 지시 (채팅)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "김아리")
  })

  test("메시지 선택 → 담당자 지정 → 업무 생성 → DONE", async ({ page }) => {
    test.setTimeout(90_000)
    const instruction = testData.find((r) => r.scenario_type === "task_instruction")!
    // 이 instruction의 gemini_complete 행 조회
    const completeRow = testData.find(
      (r) => r.task_name === instruction.task_name && r.scenario_type === "gemini_complete"
    )

    // 지시 전 ID 스냅샷
    const beforeIds = await getTaskIdSnapshot(page)

    // 메시지 전송 → 업무 지시 플로우
    await sendChatMessage(page, instruction.chat_message)
    await startTaskInstruction(page)
    await selectMessages(page, 1)
    await selectAssignee(page, instruction.receiver)
    await completeTaskInstruction(page)

    // 새로 생긴 업무 찾기
    const newTaskName = await findNewTaskName(page, beforeIds)
    if (!newTaskName) return

    const slug = await getTaskSlug(page, newTaskName)
    expect(slug).toBeTruthy()

    // CSV gemini_complete 행으로 완료 처리
    const completeSender = completeRow ? senderMap[completeRow.sender] ?? completeRow.sender : senderMap[instruction.receiver] ?? instruction.receiver
    const completeMsg = completeRow
      ? resolveSlug(completeRow.chat_message, slug)
      : `#${slug} 이 업무 완전히 끝났습니다.`

    await sendCompleteMessage(page, slug, completeSender, "김아리", completeMsg)

    // DONE 검증
    expect(await getTaskStatus(page, newTaskName)).toBe("DONE")
  })
})

// ─── 4. 업무 API 생성 + 상태 변경 ────────────────────────

test.describe("업무 상태 관리", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "김아리")
  })

  test("업무 생성 → 상세 이동 → 상태 변경 → DONE", async ({ page }) => {
    const taskName = `상태테스트_${Date.now()}`

    await createTaskViaAPI(page, { name: taskName, ownerName: "김아리" })
    await page.waitForTimeout(1000)

    const taskId = await page.evaluate(async (name) => {
      const res = await fetch("/api/tasks")
      const tasks = await res.json()
      return tasks.find((t: { name: string }) => t.name === name)?.id ?? ""
    }, taskName)

    await page.goto(`/tasks/${taskId}`)
    await page.waitForURL("**/tasks/**", { timeout: 10_000 })

    // UI로 상태 변경: TODO → IN_PROGRESS → DONE
    await changeTaskStatus(page, "IN_PROGRESS")
    await changeTaskStatus(page, "DONE")

    expect(await getTaskStatus(page, taskName)).toBe("DONE")
  })
})

// ─── 5. 멘션 업무 업데이트 ────────────────────────────────

test.describe("멘션 업무 업데이트", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "정우창")
  })

  test("# 멘션으로 업무 보고 → DONE", async ({ page }) => {
    test.setTimeout(60_000)
    const taskName = `멘션테스트_${Date.now()}`
    await createTaskViaAPI(page, { name: taskName, ownerName: "정우창" })
    await page.waitForTimeout(1000)

    const slug = await getTaskSlug(page, taskName)
    if (!slug) { test.skip(); return }

    // "이 업무 완전히 끝났습니다" → rebuildTask action: "complete"
    await sendChatMessage(page, `#${slug} 이 업무 완전히 끝났습니다.`)
    await page.waitForTimeout(12_000)

    expect(await getTaskStatus(page, taskName)).toBe("DONE")
  })
})

// ─── 6. 체크리스트 편집 ──────────────────────────────────

test.describe("체크리스트 편집", () => {
  test("체크리스트 항목 추가 → DONE", async ({ page }) => {
    test.setTimeout(60_000)
    await login(page, "김아리")

    const taskName = `체크리스트테스트_${Date.now()}`
    await createTaskViaAPI(page, {
      name: taskName,
      ownerName: "김아리",
      checklist: ["항목1", "항목2"],
    })
    await page.waitForTimeout(1000)

    // 업무 상세로 이동
    await navigateToTasks(page)
    const taskLink = page.getByRole("link", { name: taskName }).first()
    await taskLink.waitFor({ state: "visible", timeout: 10_000 })
    await taskLink.click()
    await page.waitForURL("**/tasks/**", { timeout: 10_000 })

    // 체크리스트 "추가" 버튼
    const addBtn = page.getByRole("button", { name: "추가" }).first()
    if (await addBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await addBtn.click()
      await page.waitForTimeout(500)
      await expect(page.locator("text=새 항목")).toBeVisible()
    }

    // 채팅으로 업무 완료 선언
    const slug = await getTaskSlug(page, taskName)
    if (slug) {
      await sendCompleteMessage(page, slug, "김아리", "김아리")
    }

    expect(await getTaskStatus(page, taskName)).toBe("DONE")
  })
})

// ─── 7. 워크스페이스 동기화 ──────────────────────────────

test.describe("워크스페이스 동기화", () => {
  test("업무 생성 → 워크스페이스 반영 → DONE → 사라짐", async ({ page }) => {
    test.setTimeout(60_000)
    await login(page, "김아리")

    const productId = await getFirstProductId(page)
    if (!productId) { test.skip(); return }

    const taskName = `워크스페이스테스트_${Date.now()}`
    await createTaskViaAPI(page, { name: taskName, ownerName: "김아리", productId })

    // 대시보드 → 워크스페이스 표시 확인
    await page.goto("/dashboard")
    await page.waitForTimeout(2000)
    await expect(page.locator(".react-flow").getByText(taskName, { exact: true })).toBeVisible({ timeout: 10_000 })

    // 채팅으로 완료 선언 → 워크스페이스에서 사라짐
    const slug = await getTaskSlug(page, taskName)
    if (slug) {
      await sendCompleteMessage(page, slug, "김아리", "김아리")
    }
    expect(await getTaskStatus(page, taskName)).toBe("DONE")

    await page.goto("/dashboard")
    await page.waitForTimeout(1500)
    await expect(page.locator(".react-flow").getByText(taskName, { exact: true })).not.toBeVisible({ timeout: 10_000 })
  })

  test("업무 보고(#멘션 완료) → 워크스페이스에서 사라짐", async ({ page }) => {
    test.setTimeout(60_000)
    await login(page, "김아리")

    const productId = await getFirstProductId(page)
    if (!productId) { test.skip(); return }

    const taskName = `워크스페이스완료_${Date.now()}`
    await createTaskViaAPI(page, { name: taskName, ownerName: "김아리", productId })
    await page.waitForTimeout(1000)

    const slug = await getTaskSlug(page, taskName)
    expect(slug).toBeTruthy()

    // 대시보드 워크스페이스 표시 확인
    await page.goto("/dashboard")
    await page.waitForTimeout(2000)
    await expect(page.locator(".react-flow").getByText(taskName, { exact: true })).toBeVisible({ timeout: 10_000 })

    // #멘션 완료 선언
    await ensureChatOpen(page)
    await sendChatMessage(page, `#${slug} 이 업무 완전히 끝났습니다.`)
    await page.waitForTimeout(12_000)

    expect(await getTaskStatus(page, taskName)).toBe("DONE")

    await page.goto("/dashboard")
    await page.waitForTimeout(2000)
    await expect(page.locator(".react-flow").getByText(taskName, { exact: true })).not.toBeVisible({ timeout: 10_000 })
  })
})

// ─── 8. CSV 시나리오 배치 (지시 → 보고 → gemini_complete) ─

test.describe("CSV 시나리오 배치", () => {
  const flows = findFlows(testData).slice(0, 3)

  for (const flow of flows) {
    test(`시나리오: ${flow.instruction.task_name}`, async ({ page }) => {
      test.setTimeout(90_000)
      const senderLogin = senderMap[flow.instruction.sender] ?? "김아리"
      await login(page, senderLogin)

      // 지시 전 ID 스냅샷
      const beforeIds = await getTaskIdSnapshot(page)

      // 업무 지시 플로우
      await sendChatMessage(page, flow.instruction.chat_message)
      await startTaskInstruction(page)
      await selectMessages(page, 1)
      await selectAssignee(page, flow.instruction.receiver)
      await completeTaskInstruction(page)

      // 새로 생긴 업무 찾기 + slug
      const newTaskName = await findNewTaskName(page, beforeIds)
      if (!newTaskName) return
      const slug = await getTaskSlug(page, newTaskName)
      expect(slug).toBeTruthy()

      // CSV gemini_complete 행으로 완료 처리
      const completeSenderLogin = flow.complete
        ? senderMap[flow.complete.sender] ?? flow.complete.sender
        : senderMap[flow.instruction.receiver] ?? flow.instruction.receiver
      const completeMsg = flow.complete
        ? resolveSlug(flow.complete.chat_message, slug)
        : `#${slug} 이 업무 완전히 끝났습니다.`

      await sendCompleteMessage(page, slug, completeSenderLogin, senderLogin, completeMsg)

      // DONE 검증
      expect(await getTaskStatus(page, newTaskName)).toBe("DONE")
    })
  }
})

// ─── 9. Gemini rebuildTask 풀 시나리오 ────────────────────

test.describe("Gemini 업무 문서화 흐름", () => {
  const geminiFlows = findGeminiFlows(testData)

  for (const flow of geminiFlows) {
    test(`Gemini 흐름: ${flow.taskName}`, async ({ page }) => {
      test.setTimeout(150_000)

      const instructorLogin = senderMap[flow.instruction.sender] ?? "김아리"
      await login(page, instructorLogin)

      // API로 업무 생성
      await createTaskViaAPI(page, {
        name: flow.taskName,
        ownerName: flow.instruction.receiver,
        checklist: flow.instruction.checklist_items?.split(";").filter(Boolean),
      })
      await page.waitForTimeout(1000)

      // slug 조회
      const slug = await getTaskSlug(page, flow.taskName)
      expect(slug).toBeTruthy()

      // 중간 단계(gemini_report/gemini_feedback) 순차 전송
      let lastLogin = instructorLogin
      for (const step of flow.steps) {
        const stepLogin = senderMap[step.sender] ?? step.sender
        if (stepLogin !== lastLogin) {
          await page.goto("/login")
          await login(page, stepLogin)
          lastLogin = stepLogin
        }
        await ensureChatOpen(page)
        const msg = resolveSlug(step.chat_message, slug)
        await sendChatMessage(page, msg)
        await page.waitForTimeout(5000)
      }

      // CSV gemini_complete 행으로 최종 완료 선언
      if (flow.complete) {
        const completeSenderLogin = senderMap[flow.complete.sender] ?? flow.complete.sender
        const completeMsg = resolveSlug(flow.complete.chat_message, slug)
        await sendCompleteMessage(page, slug, completeSenderLogin, lastLogin, completeMsg)
        lastLogin = completeSenderLogin
      }

      // 체크리스트 확인
      const taskId = await page.evaluate(async (name) => {
        const res = await fetch("/api/tasks")
        const tasks = await res.json()
        return tasks.find((t: { name: string }) => t.name === name)?.id ?? ""
      }, flow.taskName)

      if (taskId) {
        await page.goto(`/tasks/${taskId}`)
        await page.waitForURL("**/tasks/**", { timeout: 10_000 })
        await expect(page.locator("text=체크리스트").first()).toBeVisible({ timeout: 5_000 })
      }

      // DONE 검증
      expect(await getTaskStatus(page, flow.taskName)).toBe("DONE")
    })
  }
})

// ─── 유틸 ─────────────────────────────────────────────────

function findGeminiFlows(data: TestRow[]): {
  taskName: string
  instruction: TestRow
  steps: TestRow[]        // gemini_report + gemini_feedback (중간 단계)
  complete?: TestRow      // gemini_complete (최종 완료 선언)
}[] {
  const flows: { taskName: string; instruction: TestRow; steps: TestRow[]; complete?: TestRow }[] = []
  const seen = new Set<string>()

  for (const row of data) {
    if (row.scenario_type === "task_instruction" && !seen.has(row.task_name)) {
      const steps = data.filter(
        (r) => r.task_name === row.task_name &&
          (r.scenario_type === "gemini_report" || r.scenario_type === "gemini_feedback")
      )
      if (steps.length > 0) {
        seen.add(row.task_name)
        const complete = data.find(
          (r) => r.task_name === row.task_name && r.scenario_type === "gemini_complete"
        )
        flows.push({ taskName: row.task_name, instruction: row, steps, complete })
      }
    }
  }
  return flows
}

function findFlows(data: TestRow[]): { instruction: TestRow; complete?: TestRow }[] {
  const flows: { instruction: TestRow; complete?: TestRow }[] = []
  const seen = new Set<string>()

  for (const row of data) {
    if (row.scenario_type === "task_instruction" && !seen.has(row.task_name)) {
      seen.add(row.task_name)
      const complete = data.find(
        (r) => r.task_name === row.task_name && r.scenario_type === "gemini_complete"
      )
      flows.push({ instruction: row, complete })
    }
  }
  return flows
}

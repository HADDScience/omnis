/** 「Omnis 와 함께 업무 시작하기」 첫 글 · 일회용 표. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { buildTaskStartPrompt, parseTaskStartEntry, shouldSendTaskStart, TASK_START_TTL_MS } from "./task-start"

test("첫 글 — 짧은 요청 문장 + #슬러그 · ID · 배경 · 기대 결과 · 남은 체크리스트", () => {
  const text = buildTaskStartPrompt({
    id: "t-1",
    slug: "demo-sample",
    name: "시제품 납품",
    background: "  고객사 요청으로\n 일정이 당겨졌다 ",
    expectedResult: "다음 주 금요일까지 10개 납품",
    openChecklist: ["포장 확인", "  ", "거래명세서 보내기"],
  })
  const lines = text.split("\n")
  assert.equal(lines[0], "#demo-sample 「시제품 납품」 업무를 지금부터 함께 진행하자. 먼저 남은 체크리스트를 기준으로 다음 할 일을 제안해 줘.")
  assert.ok(text.includes("- 업무: #demo-sample (ID t-1)"))
  assert.ok(text.includes("- 배경: 고객사 요청으로 일정이 당겨졌다"))
  assert.ok(text.includes("- 기대 결과: 다음 주 금요일까지 10개 납품"))
  assert.ok(text.includes("- 남은 체크리스트 2개:\n  - 포장 확인\n  - 거래명세서 보내기"))
})

test("비어 있는 칸은 빼고, 체크리스트가 없으면 없다고 쓰고, 길면 자른다", () => {
  const text = buildTaskStartPrompt({ id: "t", slug: "s", name: "이름", background: null, expectedResult: "", openChecklist: [] })
  assert.ok(!text.includes("배경"))
  assert.ok(!text.includes("기대 결과"))
  assert.ok(text.includes("- 남은 체크리스트: 없음"))
  const long = buildTaskStartPrompt({ id: "t", slug: "s", name: "이름", background: "가".repeat(500), openChecklist: Array.from({ length: 12 }, (_, i) => `항목 ${i + 1}`) })
  const bg = long.split("\n").find((l) => l.startsWith("- 배경: "))!
  assert.equal(bg.length, "- 배경: ".length + 160)
  assert.ok(bg.endsWith("…"))
  assert.ok(long.includes("  - 항목 8\n  - 그 밖 4개(get_task 로 확인)"))
  assert.ok(!long.includes("항목 9"))
})

test("일회용 표 — 모양 확인 · 보낸 표 · 오래된 표는 보내지 않는다", () => {
  const now = 1_800_000_000_000
  const fresh = { text: "안녕 옴니스", taskId: "t", at: now - 1000, sent: false }
  assert.deepEqual(parseTaskStartEntry(JSON.stringify(fresh)), fresh)
  assert.equal(parseTaskStartEntry("{"), null)
  assert.equal(parseTaskStartEntry(JSON.stringify({ text: 1 })), null)
  assert.equal(parseTaskStartEntry(null), null)
  assert.equal(shouldSendTaskStart(fresh, now), true)
  assert.equal(shouldSendTaskStart({ ...fresh, sent: true }, now), false)
  assert.equal(shouldSendTaskStart({ ...fresh, at: now - TASK_START_TTL_MS - 1 }, now), false)
  assert.equal(shouldSendTaskStart({ ...fresh, text: " a " }, now), false)
  assert.equal(shouldSendTaskStart(null, now), false)
})

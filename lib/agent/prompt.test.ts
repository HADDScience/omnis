/**
 * 시스템 프롬프트 — 웍스 캘린더 쓰기 요청을 받으면 직접 등록을 부탁하는 규칙이 두 경로에 다 들어 있는가. 실행: pnpm test:unit
 *
 * 모델이 규칙을 따르는지는 시험하지 못한다(화면 확인은 mydocs/working/2026-10-30-omnis-calendar-read.md).
 * 여기서는 규칙이 빠지거나 경로 하나에만 남는 것을 막는다.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { CALENDAR_WRITE_RULE, WORKS_CALENDAR_URL, agentInstructions } from "./prompt"
import { routeSystemPrompt } from "@/lib/omnis-ask"

const agent = agentInstructions({ today: "2026-10-30(금)", userName: "예시 사용자", maxTurns: 12 })
const route = routeSystemPrompt("2026-10-30(금) · 시간대 Asia/Seoul", "예시 사용자")

test("일정 쓰기 규칙 — 할 수 없다 · 직접 등록 부탁 · 링크 · 「등록했다」 금지", () => {
  assert.equal(WORKS_CALENDAR_URL, "https://calendar.worksmobile.com")
  assert.match(CALENDAR_WRITE_RULE, /읽기만 하고 쓸 수 없습니다/)
  assert.match(CALENDAR_WRITE_RULE, /웍스 캘린더에 직접 등록해 주세요/)
  assert.ok(CALENDAR_WRITE_RULE.includes(WORKS_CALENDAR_URL))
  assert.match(CALENDAR_WRITE_RULE, /「등록했습니다」/)
})

test("일정 쓰기 규칙 — 정리할 칸 다섯과 지어내지 않기 · 요일 · 서울 시간대", () => {
  for (const field of ["제목:", "날짜/시간:", "장소:", "참석자:", "메모:"]) assert.ok(CALENDAR_WRITE_RULE.includes(field), field)
  assert.match(CALENDAR_WRITE_RULE, /YYYY-MM-DD\(요일\)/)
  assert.match(CALENDAR_WRITE_RULE, /Asia\/Seoul/)
  assert.match(CALENDAR_WRITE_RULE, /지어내지 말고 「\?」/)
})

test("일정 쓰기 규칙 — 다른 쓰기 도구로 대신 만들지 않는다 · 업무로 만들라고 하면 예외 · 겹치는 일정은 list_calendar", () => {
  assert.match(CALENDAR_WRITE_RULE, /create_task · draft_document 같은 다른 쓰기 도구로 일정을 대신 만들지 마세요/)
  assert.match(CALENDAR_WRITE_RULE, /「업무로 만들어 줘」 라고 분명히 했을 때만/)
  assert.match(CALENDAR_WRITE_RULE, /list_calendar 로 그날을 읽어 겹치는 일정/)
})

test("에이전트 · 질문 경로 프롬프트 둘 다 같은 규칙을 담는다", () => {
  assert.ok(agent.includes(CALENDAR_WRITE_RULE), "에이전트")
  assert.ok(route.includes(CALENDAR_WRITE_RULE), "질문 경로")
})

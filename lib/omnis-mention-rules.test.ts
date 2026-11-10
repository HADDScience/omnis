/** 사람 방의 @옴니스 — 프롬프트 뽑기 · 카톡 이식 제외 · 방 안내 줄. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { answerSummary, closesNotice, mentionPrompt, sessionNameFrom, sessionNotice } from "./omnis-mention-rules"

test("언급 뒤의 글이 그대로 프롬프트다", () => {
  assert.equal(mentionPrompt({ content: "@옴니스 이번 주 마감 업무 정리해 줘" }), "이번 주 마감 업무 정리해 줘")
  assert.equal(mentionPrompt({ content: "@옴니스님, 회의록 요약\n둘째 줄도" }), "회의록 요약\n둘째 줄도")
  assert.equal(mentionPrompt({ content: "자료 보셨죠? @옴니스: 견적 비교해 줘" }), "견적 비교해 줘")
})

test("뒤가 비면 앞의 글을 쓰고, 둘 다 비면 부르지 않는다", () => {
  assert.equal(mentionPrompt({ content: "이거 표로 정리해 줘 @옴니스" }), "이거 표로 정리해 줘")
  assert.equal(mentionPrompt({ content: "@옴니스" }), null)
  assert.equal(mentionPrompt({ content: "  @옴니스!  " }), null)
})

test("낱말이 이어지거나 메일 주소 · 다른 이름이면 부른 것이 아니다", () => {
  assert.equal(mentionPrompt({ content: "@옴니스트 에게 물어봐" }), null)
  assert.equal(mentionPrompt({ content: "a@옴니스 테스트" }), null)
  assert.equal(mentionPrompt({ content: "@사원1 확인 부탁" }), null)
  assert.equal(mentionPrompt({ content: "옴니스 한테 물어보자" }), null)
})

test("첫 언급만 본다 — 뒤의 @옴니스 는 프롬프트 안에 남는다", () => {
  assert.equal(mentionPrompt({ content: "@옴니스 「@옴니스」 라는 말이 뭐야" }), "「@옴니스」 라는 말이 뭐야")
})

test("카톡에서 옮긴 글의 @옴니스 는 실행하지 않는다", () => {
  assert.equal(mentionPrompt({ content: "@옴니스 정리해 줘", sourceId: "kakao:abc" }), null)
  assert.equal(mentionPrompt({ content: "@옴니스 정리해 줘", sourceId: "other:abc" }), "정리해 줘")
})

test("세션 이름은 프롬프트 앞부분", () => {
  assert.equal(sessionNameFrom("짧은 질문", "팀장"), "짧은 질문")
  assert.equal(sessionNameFrom("가".repeat(40), "팀장"), `${"가".repeat(30)}…`)
  assert.equal(sessionNameFrom("   ", "팀장"), "팀장님의 요청")
})

test("답 요약은 마크다운 · 각주를 떼고 앞 두 줄만", () => {
  assert.equal(answerSummary("## 결론\n- **마감** 3건 [1]\n- 나머지는 다음 주\n- 셋째 줄"), "결론 마감 3건")
  assert.equal(answerSummary("| 칸 | 값 |\n|---|---|\n| a | b |"), "칸 값 a b")
  assert.equal(answerSummary("[자료](https://example.com) 를 보세요"), "자료 를 보세요")
  assert.equal(answerSummary("가".repeat(200)).length, 121)
})

test("방 안내 줄 — 시작 · 끝 · 부르지 못함", () => {
  assert.equal(sessionNotice({ kind: "start", requesterName: "팀장" }), "🤖 옴니스가 팀장님의 요청을 처리하고 있어요")
  assert.equal(sessionNotice({ kind: "end", status: "DONE", requesterName: "팀장", answer: "업무 3건입니다." }), "🤖 옴니스 답 · 업무 3건입니다.")
  assert.equal(sessionNotice({ kind: "end", status: "DONE", requesterName: "팀장", answer: "" }), "🤖 옴니스가 답했어요")
  assert.equal(sessionNotice({ kind: "end", status: "AWAITING_APPROVAL", requesterName: "팀장" }), "🤖 옴니스가 팀장님의 확인을 기다려요")
  assert.equal(sessionNotice({ kind: "end", status: "FAILED", requesterName: "팀장" }), "🤖 옴니스가 답하지 못했어요")
  assert.equal(sessionNotice({ kind: "refused", error: "한도" }), "🤖 옴니스를 부르지 못했어요 · 한도")
  for (const s of sessionNoticeText()) assert.ok(s.startsWith("🤖"))
})

test("확인 대기는 알리되 끝을 닫지 않는다", () => {
  assert.equal(closesNotice("AWAITING_APPROVAL"), false)
  for (const s of ["DONE", "FAILED", "LIMIT", "STOPPED"] as const) assert.equal(closesNotice(s), true)
})

function sessionNoticeText() {
  return (["DONE", "AWAITING_APPROVAL", "LIMIT", "FAILED", "STOPPED"] as const).map((status) =>
    sessionNotice({ kind: "end", status, requesterName: "a", answer: "x" }),
  )
}

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  DONE_CHANGE_MAX,
  DONE_REPLY_HINT,
  DONE_TITLE_PREFIX,
  doneEntityId,
  doneNoticeText,
  isInternalPath,
  parseDoneEntityId,
  parseDoneNotice,
} from "./feature-requests-shared"
import { feedbackReply } from "./feedback"
import { notificationHref } from "./schemas/notification"
import { categoryOfType } from "./notify-rules"

test("써 볼 곳은 옴니스 안의 경로만", () => {
  for (const ok of ["/crm", "/chat/abc?x=1#m", "/settings?tab=info"]) assert.ok(isInternalPath(ok), ok)
  for (const bad of ["", "crm", "https://evil.example", "//evil.example/x", "/\\evil", "/a b", "javascript:alert(1)", `/${"a".repeat(300)}`])
    assert.equal(isInternalPath(bad), false, bad)
})

test("완료 알림 입력 — 한 줄로 모으고, 비었거나 길거나 바깥 주소면 막는다", () => {
  assert.deepEqual(parseDoneNotice({ change: "  샘플 전달을\n CRM 에 남깁니다 ", link: " /crm " }), { change: "샘플 전달을 CRM 에 남깁니다", link: "/crm" })
  assert.ok("problem" in parseDoneNotice({ change: " ", link: "/crm" }))
  assert.ok("problem" in parseDoneNotice({ change: "가".repeat(DONE_CHANGE_MAX + 1), link: "/crm" }))
  assert.ok("problem" in parseDoneNotice({ change: "x", link: "" }))
  assert.ok("problem" in parseDoneNotice({ change: "x", link: "https://example.com" }))
  assert.ok("problem" in parseDoneNotice(null))
  assert.ok("problem" in parseDoneNotice({ change: 3, link: ["/crm"] }))
})

test("알림 글 — 제목에 요청 이름, 내용은 바뀐 것 한 줄 + 답장 안내", () => {
  const t = doneNoticeText("검색 결과 원본 열기", { change: "답 아래에서 원본 파일을 엽니다", link: "/chat" })
  assert.equal(t.title, `${DONE_TITLE_PREFIX}검색 결과 원본 열기`)
  assert.equal(t.content, `답 아래에서 원본 파일을 엽니다\n${DONE_REPLY_HINT}`)
  assert.match(t.content, /써 보고 불편하면 답장 주세요/)
  // 긴 제목은 줄인다
  assert.ok(doneNoticeText("가".repeat(100), { change: "x", link: "/" }).title.length <= DONE_TITLE_PREFIX.length + 60)
})

test("알림을 누르면 써 볼 곳으로 — entityId 는 요청 id 와 경로", () => {
  const id = doneEntityId("4f0c9a1e-0000-4000-8000-000000000001", "/crm/samples?tab=new")
  assert.deepEqual(parseDoneEntityId(id), { requestId: "4f0c9a1e-0000-4000-8000-000000000001", link: "/crm/samples?tab=new" })
  assert.equal(notificationHref("feature_request_done", id), "/crm/samples?tab=new")
  // 모양이 틀리거나 바깥 주소면 열지 않는다
  assert.equal(notificationHref("feature_request_done", "abc"), null)
  assert.equal(notificationHref("feature_request_done", "abc://evil.example"), null)
  assert.equal(notificationHref("feature_request_done", null), null)
  // 개발자에게 가는 기능 요청 알림은 그대로 관리 화면
  assert.equal(notificationHref("feature_request", "abc"), "/settings/feature-requests")
})

test("푸시 종류(채팅 · 업무 · 일정)로 꺼지지 않는다 — 요청한 사람이 기다리던 소식", () => {
  assert.equal(categoryOfType("feature_request_done"), null)
})

test("답장 — 제목은 [답장] + 요청 제목, 빈 내용은 막는다", () => {
  assert.deepEqual(feedbackReply("CRM 샘플 전달 등록", " 수량 칸이 작아요 "), { title: "[답장] CRM 샘플 전달 등록", detail: "수량 칸이 작아요" })
  assert.ok("problem" in feedbackReply("x", "  "))
  assert.ok("problem" in feedbackReply("x", 1))
  const long = feedbackReply("가".repeat(80), "a")
  assert.ok(!("problem" in long) && long.title.length <= "[답장] ".length + 60)
})

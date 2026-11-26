/** 제자리 편집 한 칸 — 저장 · 취소 · 실패 되돌림 · 충돌. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  beginEdit,
  cancelEdit,
  commitEdit,
  editDraft,
  initField,
  keyAction,
  noteFromError,
  sameSet,
  sameText,
  sameValue,
  saveFailed,
  saveSucceeded,
  server,
  shownValue,
} from "./inline-field"

test("저장: 바꾼 값을 보내고, 서버 새 값이 오기 전까지 고친 값을 보인다", () => {
  const srv = server("검토")
  let s = beginEdit(initField("검토"), srv)
  assert.equal(s.mode, "edit")
  s = editDraft(s, "준비")
  const out = commitEdit(s, srv, sameValue)
  assert.deepEqual(out.send, { next: "준비", prev: "검토" })
  assert.equal(out.state.mode, "saving")
  assert.equal(shownValue(out.state, srv), "준비")
  s = saveSucceeded(out.state)
  assert.equal(s.mode, "view")
  assert.equal(s.saved, true)
  // router.refresh 전: 서버 값이 그대로여도 저장한 값
  assert.equal(shownValue(s, srv), "준비")
  // 서버 새 값이 오면 그것
  assert.equal(shownValue(s, server("준비")), "준비")
  assert.equal(shownValue(s, server("제출")), "제출")
})

test("바뀐 게 없으면 보내지 않고 보기로 돌아간다(앞뒤 빈칸만 다른 글도)", () => {
  const srv = server("메모")
  const s = editDraft(beginEdit(initField("메모"), srv), "  메모 ")
  const out = commitEdit(s, srv, sameText)
  assert.equal(out.send, null)
  assert.equal(out.state.mode, "view")
})

test("취소: 입력을 버리고 원래 값을 보인다", () => {
  const srv = server("2026-12-01")
  let s = editDraft(beginEdit(initField("2026-12-01"), srv), "2027-01-05")
  s = cancelEdit(s)
  assert.equal(s.mode, "view")
  assert.equal(shownValue(s, srv), "2026-12-01")
  // 다시 열면 원래 값부터
  assert.equal(beginEdit(s, srv).draft, "2026-12-01")
})

test("실패: 고친 값을 버리고 서버 값으로 되돌리며 이유를 남긴다", () => {
  const srv = server("")
  const s = editDraft(beginEdit(initField(""), srv), "최대 2억 원")
  const { state } = commitEdit(s, srv, sameText)
  const failed = saveFailed(state, noteFromError(new Error("서버 오류")))
  assert.equal(failed.mode, "view")
  assert.equal(shownValue(failed, srv), "")
  assert.deepEqual(failed.note, { kind: "error", message: "서버 오류" })
  // 다시 누르면 이유가 지워진다
  assert.equal(beginEdit(failed, srv).note, null)
})

test("409 는 충돌 — 되돌린 뒤 서버 새 값을 보인다", () => {
  const err = Object.assign(new Error("그새 다른 사람이 마감을 바꿨습니다"), {
    status: 409,
  })
  const note = noteFromError(err)
  assert.equal(note.kind, "conflict")
  const srv = server("2026-12-01")
  const s = editDraft(beginEdit(initField("2026-12-01"), srv), "2026-12-10")
  const failed = saveFailed(commitEdit(s, srv, sameValue).state, note)
  assert.equal(shownValue(failed, server("2026-12-20")), "2026-12-20")
})

test("저장 중에는 다시 열지 않고, 칸 벗어남이 한 번 더 와도 두 번 보내지 않는다", () => {
  const srv = server("a")
  const { state } = commitEdit(editDraft(beginEdit(initField("a"), srv), "b"), srv, sameValue)
  assert.equal(beginEdit(state, srv), state)
  assert.equal(commitEdit(state, srv, sameValue).send, null)
  // Esc 뒤 blur
  const cancelled = cancelEdit(editDraft(beginEdit(initField("a"), srv), "c"))
  assert.equal(commitEdit(cancelled, srv, sameValue).send, null)
})

test("선택 칸은 고른 값으로 바로 저장한다(draft 를 거치지 않는다)", () => {
  const srv = server("")
  const out = commitEdit(beginEdit(initField(""), srv), srv, sameValue, "task-1")
  assert.deepEqual(out.send, { next: "task-1", prev: "" })
})

test("담당은 순서와 상관없이 같은 사람들이면 같다", () => {
  assert.equal(sameSet(["a", "b"], ["b", "a"]), true)
  assert.equal(sameSet(["a"], ["a", "b"]), false)
})

test("키: Enter 저장, Esc 취소, 여러 줄 칸의 Shift+Enter 와 한글 조합 중 Enter 는 그대로", () => {
  assert.equal(keyAction("Enter"), "commit")
  assert.equal(keyAction("Escape"), "cancel")
  assert.equal(keyAction("Enter", { multiline: true }), "commit")
  assert.equal(keyAction("Enter", { multiline: true, shift: true }), null)
  assert.equal(keyAction("Enter", { composing: true }), null)
  assert.equal(keyAction("a"), null)
})

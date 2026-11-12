import { test } from "node:test"
import assert from "node:assert/strict"
import { REPLY_TARGET_MISSING, aroundFailureMessage, replyJump } from "./reply-jump"

test("불러온 범위 안의 원글이면 그 자리로, 밖이면 불러온다", () => {
  const loaded = [{ id: "a" }, { id: "b", deletedAt: null }]
  assert.equal(replyJump({ id: "b" }, loaded), "here")
  assert.equal(replyJump({ id: "zz" }, loaded), "load")
})

test("지운 원글은 어디서 알든 찾을 수 없다고 한다", () => {
  assert.equal(replyJump({ id: "a", deleted: true }, [{ id: "a" }]), "missing")
  assert.equal(replyJump({ id: "x", deleted: true }, []), "missing")
  // 인용을 받은 뒤 원글이 지워져 목록에만 지운 자리로 남은 경우
  assert.equal(replyJump({ id: "a" }, [{ id: "a", deletedAt: "2026-11-12T00:00:00Z" }]), "missing")
})

test("없는 글 · 볼 수 없는 방은 원글이 없는 것과 같은 안내", () => {
  assert.equal(aroundFailureMessage(404), REPLY_TARGET_MISSING)
  assert.equal(aroundFailureMessage(403), REPLY_TARGET_MISSING)
  assert.equal(aroundFailureMessage(500), "그 메시지를 불러오지 못했습니다")
  assert.equal(aroundFailureMessage(null), "그 메시지를 불러오지 못했습니다")
})

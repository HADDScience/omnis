import assert from "node:assert/strict"
import { test } from "node:test"
import { displayAuthor, externalSpeakerLabel } from "./external-speaker"

const ext = { id: "e1", name: "홍길동", org: "예시대학교", title: "연구원" }

test("이름 · 소속 · 직급 순서, 모르는 칸은 뺀다", () => {
  assert.equal(externalSpeakerLabel(ext), "홍길동 · 예시대학교 · 연구원")
  assert.equal(externalSpeakerLabel({ ...ext, org: null }), "홍길동 · 연구원")
  assert.equal(externalSpeakerLabel({ ...ext, org: " ", title: null }), "홍길동")
})

test("외부 발화자 글은 시스템 계정으로 보이지 않는다", () => {
  const a = displayAuthor({ id: "system", name: "Omnis" }, ext)
  assert.notEqual(a.id, "system")
  assert.equal(a.id, "external:e1")
  assert.equal(a.name, "홍길동 · 예시대학교 · 연구원")
})

test("외부 발화자가 없으면 작성자 그대로", () => {
  const author = { id: "u1", name: "직원A" }
  assert.equal(displayAuthor(author, null), author)
  assert.equal(displayAuthor(author, undefined), author)
})

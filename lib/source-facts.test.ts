import { test } from "node:test"
import assert from "node:assert/strict"
import { sourceFact, sourceFactToolLine, sourceHref, sourcePlace, type SourceRow } from "./source-facts"

const row = (over: Partial<SourceRow> = {}): SourceRow => ({
  id: "m1",
  roomId: "default-room",
  taskId: null,
  sourceId: null,
  content: "안녕하세요",
  createdAt: new Date("2026-11-04T07:11:56Z"),
  author: "정우창",
  room: { kind: "COMPANY", name: "전체" },
  task: null,
  files: [],
  ...over,
})

test("바로가기 — 업무에 묶인 글은 업무방, 아니면 그 방. 해시가 그 글을 가리킨다", () => {
  assert.equal(sourceHref({ id: "m1", roomId: "default-room", taskId: "t1" }), "/chat/task/t1#m-m1")
  assert.equal(sourceHref({ id: "m1", roomId: "r 1", taskId: null }), "/chat/r%201#m-m1")
})

test("어디서 쓴 글인지 — 업무 · 전사방 · 단톡방 이름 · 1:1 · 옴니스 대화", () => {
  assert.equal(sourcePlace({ room: { kind: "COMPANY", name: "전체" }, task: { name: "발표자료 준비" } }), "업무 「발표자료 준비」")
  assert.equal(sourcePlace({ room: { kind: "COMPANY", name: "전체" }, task: null }), "전사방")
  assert.equal(sourcePlace({ room: { kind: "GROUP", name: "인턴방" }, task: null }), "「인턴방」")
  assert.equal(sourcePlace({ room: { kind: "DM", name: "x" }, task: null }), "1:1 대화")
  assert.equal(sourcePlace({ room: { kind: "OMNIS_DM", name: "x" }, task: null }), "옴니스 대화")
})

test("카톡 자리표시 글(「File: …」 · 첨부 없음)은 missing 으로, 실제 첨부가 있으면 files 로", () => {
  const placeholder = sourceFact(row({ sourceId: "kakao:abc", content: "File: P1_우수사례발표_하드사이언스_261104_WC_06.pdf", taskId: "t1", task: { name: "발표자료 준비" } }))
  assert.deepEqual(placeholder.missing, { kind: "file", name: "P1_우수사례발표_하드사이언스_261104_WC_06.pdf", deleted: false })
  assert.equal(placeholder.files.length, 0)
  assert.equal(placeholder.href, "/chat/task/t1#m-m1")
  assert.equal(placeholder.createdAt, "2026-11-04T07:11:56.000Z")

  const file = { id: "f1", name: "P1_우수사례발표_하드사이언스_261105_WC_04.pdf", size: 1200, mimeType: "application/pdf" }
  const real = sourceFact(row({ sourceId: "kakao:def", content: "", files: [file] }))
  assert.equal(real.missing, null)
  assert.deepEqual(real.files, [file])

  // 첨부는 있는데 이 사람이 못 보는 것(참여자 전용)이면 「없다」 고 하지 않는다
  assert.equal(sourceFact(row({ sourceId: "kakao:x", content: "File: a.pdf", files: [], fileCount: 1 })).missing, null)
  // 옴니스에서 직접 쓴 「File: 」 로 시작하는 글은 자리표시가 아니다
  assert.equal(sourceFact(row({ content: "File: 이름 정리 규칙" })).missing, null)
})

test("도구 결과 한 줄 — 원문 자리 · 바로가기, 첨부 ID 또는 첨부 없음", () => {
  const placeholder = sourceFact(row({ sourceId: "kakao:abc", content: "File: a.pdf", taskId: "t1", task: { name: "발표" } }))
  assert.equal(
    sourceFactToolLine(placeholder),
    "↳ 원문: 업무 「발표」 · 정우창 · 바로가기 /chat/task/t1#m-m1 · [첨부 없음 — 「a.pdf」 파일은 카톡에서 옮길 때 받지 못해 옴니스에 원본이 없다. 열기 · 내려받기 불가. 카톡 원본이나 보낸 사람에게 요청해야 한다]",
  )
  const real = sourceFact(row({ files: [{ id: "f1", name: "b.pdf", size: 1, mimeType: null }] }))
  assert.equal(sourceFactToolLine(real), "↳ 원문: 전사방 · 정우창 · 바로가기 /chat/default-room#m-m1 · [첨부: b.pdf (f1)]")
  assert.equal(sourceFactToolLine(sourceFact(row())), "↳ 원문: 전사방 · 정우창 · 바로가기 /chat/default-room#m-m1")
})

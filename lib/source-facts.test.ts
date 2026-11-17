import { test } from "node:test"
import assert from "node:assert/strict"
import {
  MENTION_FILES_MAX,
  mentionedFileNames,
  pickMentionedFiles,
  sourceFact,
  sourceFactToolLine,
  sourceHref,
  sourcePlace,
  type MentionCandidate,
  type SourceRow,
} from "./source-facts"

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

// ─── 본문이 이름을 댄 파일(기능 요청 #232) ───────────────────────────────

const cand = (over: Partial<MentionCandidate> = {}): MentionCandidate => ({
  id: "f9",
  name: "보고서_v2.pdf",
  size: 10,
  mimeType: "application/pdf",
  createdAt: new Date("2026-11-10T00:00:00Z"),
  privateToUserId: null,
  taskId: null,
  message: { id: "m9", roomId: "default-room", taskId: null, deleted: false, roomMemberIds: [] },
  ...over,
})

test("이름 뽑기 — 확장자 있는 이름, 조사 · 괄호 · 대소문자, 판 번호는 파일이 아니다", () => {
  assert.deepEqual(mentionedFileNames({ content: "보고서_v2.pdf를 올렸고 (견적서.xlsx 도) 봐 주세요", sourceId: null, fileCount: 0 }), [
    "보고서_v2.pdf",
    "(견적서.xlsx",
    "견적서.xlsx",
  ])
  assert.deepEqual(mentionedFileNames({ content: "v2.0 으로 올렸어요. 회의는 3.5시간", sourceId: null, fileCount: 0 }), [])
  // 확장자 뒤에 영문이 이어지면 파일이 아니다
  assert.deepEqual(mentionedFileNames({ content: "report.pdfx 는 없다", sourceId: null, fileCount: 0 }), [])
  // 카톡 자리표시는 빈칸 든 이름도 통째로
  assert.deepEqual(mentionedFileNames({ content: "File: 가상 계획서 최종.hwpx", sourceId: "kakao:z", fileCount: 0 }), ["가상 계획서 최종.hwpx", "최종.hwpx"])
})

test("이름 뽑기 거부 — 이름을 대지 않은 글 · 첨부가 있는 글(못 보는 첨부 포함)은 찾지 않는다", () => {
  assert.deepEqual(mentionedFileNames({ content: "내일 회의 자료 정리해 주세요", sourceId: null, fileCount: 0 }), [])
  assert.deepEqual(mentionedFileNames({ content: "보고서_v2.pdf 올립니다", sourceId: null, fileCount: 1 }), [])
})

test("이름이 같은 파일 — 정확히 같은 이름(대소문자 · 한글 꼴 무시)만, 새것부터, 바로가기는 올린 글", () => {
  const nfd = "보고서_v2.pdf".normalize("NFD")
  const picked = pickMentionedFiles(
    ["보고서_V2.PDF"],
    [cand(), cand({ id: "f10", name: nfd, createdAt: new Date("2026-11-11T00:00:00Z"), message: null, taskId: "t7" })],
    { userId: "u1" },
  )
  assert.deepEqual(picked.map((f) => [f.id, f.href]), [["f10", "/tasks/t7"], ["f9", "/chat/default-room#m-m9"]])
  // 업무방 글에 붙은 파일은 업무방 그 글로
  assert.equal(pickMentionedFiles(["보고서_v2.pdf"], [cand({ message: { id: "m3", roomId: "r", taskId: "t1", deleted: false, roomMemberIds: [] } })], { userId: "u1" })[0].href, "/chat/task/t1#m-m3")
})

test("이름이 같은 파일 거부 — 일부만 같은 이름 · 못 드는 방 · 남의 미첨부 파일 · 지운 글 · 질문 경로의 전용 첨부 · 자기 첨부", () => {
  // 이름 일부만 같다
  assert.deepEqual(pickMentionedFiles(["보고서.pdf"], [cand()], { userId: "u1" }), [])
  assert.deepEqual(pickMentionedFiles(["v2.pdf"], [cand()], { userId: "u1" }), [])
  // 참여자 전용 방의 파일 — 그 방에 없는 사람에게는 잇지 않는다, 참여자에게는 잇는다
  const roomFile = cand({ privateToUserId: "u2", message: { id: "m5", roomId: "secret-room", taskId: null, deleted: false, roomMemberIds: ["u2", "u3"] } })
  assert.deepEqual(pickMentionedFiles(["보고서_v2.pdf"], [roomFile], { userId: "u1" }), [])
  assert.equal(pickMentionedFiles(["보고서_v2.pdf"], [roomFile], { userId: "u3" }).length, 1)
  // 질문 경로(publicOnly)는 참여자여도 전용 첨부를 잇지 않는다
  assert.deepEqual(pickMentionedFiles(["보고서_v2.pdf"], [roomFile], { userId: "u3", publicOnly: true }), [])
  // 아직 안 붙은 남의 전용 파일
  assert.deepEqual(pickMentionedFiles(["보고서_v2.pdf"], [cand({ privateToUserId: "u2", message: null })], { userId: "u1" }), [])
  // 지운 글에 붙은 파일
  assert.deepEqual(pickMentionedFiles(["보고서_v2.pdf"], [cand({ message: { id: "m9", roomId: "default-room", taskId: null, deleted: true, roomMemberIds: [] } })], { userId: "u1" }), [])
  // 이름을 대지 않았으면 없다 · 자기 첨부는 빼고
  assert.deepEqual(pickMentionedFiles([], [cand()], { userId: "u1" }), [])
  assert.deepEqual(pickMentionedFiles(["보고서_v2.pdf"], [cand()], { userId: "u1", exclude: new Set(["f9"]) }), [])
})

test("이름이 같은 파일 상한 — 같은 이름 판이 많아도 MENTION_FILES_MAX 개", () => {
  const many = Array.from({ length: 9 }, (_, i) => cand({ id: `f${i}`, createdAt: new Date(2026, 10, i + 1) }))
  const picked = pickMentionedFiles(["보고서_v2.pdf"], many, { userId: "u1" })
  assert.equal(picked.length, MENTION_FILES_MAX)
  assert.equal(picked[0].id, "f8")
})

test("도구 결과 한 줄 — 이름이 같은 파일은 「이 글의 첨부 아님」 으로 파일 ID · 올린 곳과 함께", () => {
  const mentioned = [{ id: "f9", name: "보고서_v2.pdf", size: 1, mimeType: null, href: "/chat/default-room#m-m9" }]
  assert.equal(
    sourceFactToolLine(sourceFact(row({ author: "김가상", content: "보고서_v2.pdf 확인 부탁드려요", mentioned }))),
    "↳ 원문: 전사방 · 김가상 · 바로가기 /chat/default-room#m-m1 · [이름이 같은 파일(이 글의 첨부 아님): 보고서_v2.pdf (f9) 올린 곳 /chat/default-room#m-m9]",
  )
  // 자리표시 글이면 「첨부 없음」 뒤에 잇는다
  const line = sourceFactToolLine(sourceFact(row({ sourceId: "kakao:q", content: "File: 보고서_v2.pdf", mentioned })))
  assert.match(line, /\[첨부 없음 — 「보고서_v2\.pdf」 파일은.*\] · \[이름이 같은 파일\(이 글의 첨부 아님\): 보고서_v2\.pdf \(f9\)/)
  assert.deepEqual(sourceFact(row()).mentioned, [])
})

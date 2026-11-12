import { test } from "node:test"
import assert from "node:assert/strict"
import {
  downloadMode,
  extractLinks,
  fileCategory,
  matchesKind,
  missingListText,
  periodStart,
  safeName,
  splitBatches,
  zipEntryNames,
  zipFolderName,
} from "./room-drawer"

test("기간 — 서울 기준 이번 주(월 0시) · 이번 달(1일 0시) · 전체", () => {
  // 2026-11-12(목) 01:00 KST = 11-11 16:00Z
  const now = new Date("2026-11-11T16:00:00Z")
  assert.equal(periodStart("week", now)!.toISOString(), "2026-11-08T15:00:00.000Z") // 11-09(월) 00:00 KST
  assert.equal(periodStart("month", now)!.toISOString(), "2026-10-31T15:00:00.000Z") // 11-01 00:00 KST
  assert.equal(periodStart("all", now), null)
  // 일요일 23시 KST 는 그 주 월요일에 속한다
  assert.equal(periodStart("week", new Date("2026-11-15T14:00:00Z"))!.toISOString(), "2026-11-08T15:00:00.000Z")
})

test("종류 — 사진 탭과 파일 탭을 가른다", () => {
  assert.equal(fileCategory({ name: "a.jpg", mimeType: "image/jpeg" }), "photo")
  assert.equal(fileCategory({ name: "a.gif", mimeType: "image/gif" }), "gif")
  assert.equal(fileCategory({ name: "a.svg", mimeType: "image/svg+xml" }), "other")
  assert.equal(fileCategory({ name: "보고서.hwp", mimeType: "application/octet-stream" }), "doc")
  assert.equal(fileCategory({ name: "녹음.m4a", mimeType: "audio/mp4" }), "audio")
  assert.equal(fileCategory({ name: "x.PDF", mimeType: "application/octet-stream" }), "pdf")
  assert.ok(matchesKind("photos", "all", { name: "a.png", mimeType: "image/png" }))
  assert.ok(!matchesKind("files", "all", { name: "a.png", mimeType: "image/png" }))
  assert.ok(matchesKind("files", "sheet", { name: "a.xlsx", mimeType: "application/vnd" }))
  assert.ok(!matchesKind("files", "pdf", { name: "a.xlsx", mimeType: "application/vnd" }))
})

test("zip 안 이름 — 방이름_YYMM/날짜_보낸사람_원래이름, 겹치면 번호", () => {
  const now = new Date("2026-11-12T03:00:00Z")
  assert.equal(zipFolderName("HADD/수원대", now), "HADD_수원대_2611")
  const item = (name: string, author = "정우창", createdAt = "2026-11-10T16:30:00Z") => ({ fileId: name, name, size: 1, mimeType: "image/jpeg", createdAt, authorName: author })
  const names = zipEntryNames([item("사진.jpg"), item("사진.jpg"), item("사진.JPG"), item("README"), item("README")], "전사방", now)
  assert.deepEqual(names, [
    "전사방_2611/2026-11-11_정우창_사진.jpg",
    "전사방_2611/2026-11-11_정우창_사진 (2).jpg",
    "전사방_2611/2026-11-11_정우창_사진 (3).JPG",
    "전사방_2611/2026-11-11_정우창_README",
    "전사방_2611/2026-11-11_정우창_README (2)",
  ])
  assert.equal(safeName('a:b*c?"d<>|/e'), "a_b_c__d____e")
  assert.equal(safeName("..."), "파일")
})

test("1GB 나누기 — 순서를 지키고, 상한보다 큰 파일은 혼자 한 묶음", () => {
  const sizes = [400, 400, 400, 1500, 100]
  const batches = splitBatches(sizes.map((size) => ({ size })), 1000)
  assert.deepEqual(batches.map((b) => b.map((x) => x.size)), [[400, 400], [400], [1500], [100]])
  assert.deepEqual(splitBatches([], 1000), [])
})

test("빠진파일.txt — 날짜 · 보낸 사람 · 이름", () => {
  const text = missingListText("대표님", [{ messageId: "m", createdAt: "2026-11-01T01:00:00Z", authorName: "허채정", label: "견적서.pdf", kind: "file" }])
  assert.match(text, /받지 못한 첨부 1개/)
  assert.match(text, /2026-11-01\t허채정\t견적서\.pdf/)
})

test("링크 — 끝 문장부호 · 짝 없는 괄호를 떼고 중복은 한 번", () => {
  assert.deepEqual(extractLinks("보세요 https://a.com/x?y=1. 그리고 (https://b.kr/p) https://a.com/x?y=1"), ["https://a.com/x?y=1", "https://b.kr/p"])
  assert.deepEqual(extractLinks("https://ko.wikipedia.org/wiki/X_(Y)"), ["https://ko.wikipedia.org/wiki/X_(Y)"])
  assert.deepEqual(extractLinks("링크 없음 http:// 끝"), [])
})

test("받는 방법 — 폰에서 사진 · 동영상만이면 공유 시트, 문서가 섞이면 zip, PC 는 zip", () => {
  const photo = { name: "a.jpg", mimeType: "image/jpeg" }
  const doc = { name: "a.pdf", mimeType: "application/pdf" }
  assert.equal(downloadMode({ touch: true, canShareFiles: true, items: [photo] }), "share")
  assert.equal(downloadMode({ touch: true, canShareFiles: true, items: [photo, doc] }), "zip")
  assert.equal(downloadMode({ touch: true, canShareFiles: false, items: [photo] }), "zip")
  assert.equal(downloadMode({ touch: false, canShareFiles: true, items: [photo] }), "zip")
})

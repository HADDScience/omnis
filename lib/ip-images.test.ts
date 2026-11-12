import { test } from "node:test"
import assert from "node:assert/strict"

import {
  checkImageInput,
  coverOf,
  groupImages,
  IMAGE_MEMO_MAX,
  isImageMime,
  LAYOUT_STORAGE_KEY,
  parseLayout,
  placeholderGlyph,
  readLayout,
  sortImages,
  writeLayout,
  type CaseImage,
} from "./ip-images"

const img = (over: Partial<CaseImage>): CaseImage => ({
  id: over.id ?? "i",
  entityKind: "trademark",
  entityId: "TM-01",
  fileId: "f",
  name: "a.png",
  mimeType: "image/png",
  memo: "",
  date: null,
  isPrimary: false,
  createdAt: "2026-11-01T00:00:00.000Z",
  ...over,
})

test("대표 이미지가 맨 앞, 나머지는 날짜가 최근인 것부터", () => {
  const list = sortImages([
    img({ id: "old", date: "2026-09-01" }),
    img({ id: "new", date: "2026-10-29" }),
    img({ id: "primary", date: "2026-01-01", isPrimary: true }),
  ])
  assert.deepEqual(list.map((i) => i.id), ["primary", "new", "old"])
})

test("날짜가 없으면 올린 날로 센다", () => {
  const list = sortImages([
    img({ id: "dated", date: "2026-10-01" }),
    img({ id: "undated", createdAt: "2026-11-05T09:00:00.000Z" }),
  ])
  assert.deepEqual(list.map((i) => i.id), ["undated", "dated"])
})

test("갤러리 표지: 대표가 있으면 대표, 없으면 가장 최근 것, 하나도 없으면 null", () => {
  assert.equal(coverOf(undefined), null)
  assert.equal(coverOf([]), null)
  assert.equal(coverOf([img({ id: "a", date: "2026-01-01" }), img({ id: "b", date: "2026-03-01" })])?.id, "b")
  assert.equal(coverOf([img({ id: "a", isPrimary: true, date: "2026-01-01" }), img({ id: "b", date: "2026-03-01" })])?.id, "a")
})

test("건별로 묶는다 — 상표와 특허의 같은 번호가 섞이지 않는다", () => {
  const map = groupImages([
    img({ id: "t1", entityId: "X-1" }),
    img({ id: "p1", entityKind: "patent", entityId: "X-1" }),
    img({ id: "t2", entityId: "X-1", isPrimary: true }),
  ])
  assert.deepEqual(map.get("trademark:X-1")?.map((i) => i.id), ["t2", "t1"])
  assert.deepEqual(map.get("patent:X-1")?.map((i) => i.id), ["p1"])
})

test("메모 · 날짜 검사: 공백 정리 · 빈 날짜는 지우기 · 틀린 날짜와 긴 메모는 거절", () => {
  assert.deepEqual(checkImageInput({ memo: "  10/29  변리사 송부 시안 " }), { ok: true, value: { memo: "10/29 변리사 송부 시안" } })
  assert.deepEqual(checkImageInput({ date: "" }), { ok: true, value: { date: null } })
  assert.deepEqual(checkImageInput({ date: "2026-10-29", isPrimary: true }), { ok: true, value: { date: "2026-10-29", isPrimary: true } })
  assert.equal(checkImageInput({ date: "2026-02-30" }).ok, false)
  assert.equal(checkImageInput({ date: "10/29" }).ok, false)
  assert.equal(checkImageInput({ memo: "가".repeat(IMAGE_MEMO_MAX + 1) }).ok, false)
  assert.equal(checkImageInput({ isPrimary: "yes" }).ok, false)
  // 안 보낸 칸은 건드리지 않는다
  assert.deepEqual(checkImageInput({}), { ok: true, value: {} })
})

test("이미지 형식: 미리보기를 그릴 수 있는 것만 — SVG · PDF 는 받지 않는다", () => {
  assert.equal(isImageMime("image/png"), true)
  assert.equal(isImageMime("IMAGE/JPEG"), true)
  assert.equal(isImageMime("image/svg+xml"), false)
  assert.equal(isImageMime("application/pdf"), false)
  assert.equal(isImageMime(null), false)
})

test("자리표시 글자: 이름 첫 글자, 영문은 대문자, 괄호 머리는 건너뛴다", () => {
  assert.equal(placeholderGlyph("vivoframe"), "V")
  assert.equal(placeholderGlyph("아떼셀"), "아")
  assert.equal(placeholderGlyph("(가칭) 오가농"), "오")
  assert.equal(placeholderGlyph("  "), "?")
})

test("보기 전환 기억: 갤러리만 갤러리, 나머지는 목록 · 저장소가 막혀도 깨지지 않는다", () => {
  assert.equal(parseLayout("gallery"), "gallery")
  assert.equal(parseLayout("grid"), "list")
  assert.equal(parseLayout(null), "list")

  const box = new Map<string, string>()
  const storage = { getItem: (k: string) => box.get(k) ?? null, setItem: (k: string, v: string) => void box.set(k, v) }
  assert.equal(readLayout(storage), "list")
  writeLayout(storage, "gallery")
  assert.equal(box.get(LAYOUT_STORAGE_KEY), "gallery")
  assert.equal(readLayout(storage), "gallery")

  const blocked = {
    getItem: () => {
      throw new Error("SecurityError")
    },
    setItem: () => {
      throw new Error("QuotaExceeded")
    },
  }
  assert.equal(readLayout(blocked), "list")
  assert.doesNotThrow(() => writeLayout(blocked, "gallery"))
  assert.equal(readLayout(null), "list")
})

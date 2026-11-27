/** 공고 첨부 상태. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import { attLine, attView, bonusEmptyReason, reasonOf, summarizeAtt } from "./grant-attachments"

const row = (o: Partial<Parameters<typeof reasonOf>[0]>) => ({
  download_block: null,
  extract_status: "ok",
  image_only: null,
  local_path: "/x",
  ...o,
})

test("수집기 첨부 행 → 까닭 — 다 읽음 · 이미지 · 일부 · 안 읽음 · 받지 못함 · 막힘 · 주소 없음", () => {
  assert.equal(reasonOf(row({})), null)
  assert.equal(reasonOf(row({ extract_status: "partial", image_only: 1 })), "image_partial")
  assert.equal(reasonOf(row({ extract_status: "partial" })), "partial")
  assert.equal(reasonOf(row({ extract_status: "failed", image_only: 1 })), "image")
  assert.equal(reasonOf(row({ extract_status: "failed" })), "failed")
  assert.equal(reasonOf(row({ extract_status: "skipped" })), "skipped")
  assert.equal(reasonOf(row({ extract_status: "download_failed", local_path: null })), "download_failed")
  assert.equal(reasonOf(row({ extract_status: null, local_path: null })), "download_failed")
  assert.equal(reasonOf(row({ download_block: "robots", extract_status: null, local_path: null })), "robots")
  assert.equal(reasonOf(row({ download_block: "no_url", extract_status: null, local_path: null })), "no_url")
})

test("같은 이름은 한 번 — 한 번이라도 읽혔으면 읽은 것", () => {
  const s = summarizeAtt([
    { name: "공고문.hwp", reason: "download_failed" },
    { name: "공고문.hwp", reason: null },
    { name: "양식.zip", reason: "skipped" },
    { name: "안내.pdf", reason: "image" },
    { name: "안내.pdf", reason: "image_partial" },
  ])
  assert.equal(s.total, 3)
  assert.deepEqual(s.items, [
    { name: "양식.zip", reason: "skipped" },
    { name: "안내.pdf", reason: "image_partial" },
  ])
})

const view = (status: string | null, items: { name: string; reason: string }[] = [], total = items.length) =>
  attView({ attStatus: status, attCheckedAt: "2026-11-27T06:10:00Z", attNote: status === "unknown" ? "오류 화면" : null, attFiles: { total, items } })

test("첨부 상태 한 줄 — 없음(원문 확인 날짜) · 확인 불가 · 있음과 못 읽은 까닭별 수", () => {
  assert.equal(attLine(view("none")), "첨부 없음 · 원문 확인 2026-11-27")
  assert.equal(attLine(view("unknown")), "첨부 확인 불가 · 오류 화면 · 원문 확인 2026-11-27")
  assert.equal(
    attLine(view("present", [{ name: "a.pdf", reason: "image" }, { name: "b.pdf", reason: "image" }, { name: "c", reason: "robots" }], 12)),
    "첨부 12개 · 이미지라 못 읽음 2 · 사이트가 받기를 막음 1 · 원문 확인 2026-11-27"
  )
  assert.equal(attLine(view("present", [], 3)), "첨부 3개 · 원문 확인 2026-11-27")
  assert.equal(attLine(view(null)), null)
  assert.equal(attLine(attView({ attStatus: "present", attCheckedAt: null, attNote: null, attFiles: "깨진 값" })), "첨부 0개")
})

test("이름별 표시 · 글자를 못 얻은 수(일부만 읽은 것은 빼고)", () => {
  const v = view("present", [{ name: "a.pdf", reason: "image" }, { name: "b.pdf", reason: "image_partial" }, { name: "c.zip", reason: "skipped" }], 5)!
  assert.deepEqual(v.byName, { "a.pdf": "이미지라 못 읽음", "b.pdf": "이미지라 일부만 읽음", "c.zip": "압축·그림 파일이라 안 읽음" })
  assert.equal(v.unreadable, 2)
})

test("가점이 비었을 때 까닭 — 첨부 없음 · 확인 불가 · 못 읽음 · 그냥 없음, 뽑지 않았으면 null", () => {
  assert.equal(bonusEmptyReason("no_text", 0, view("none")), "가점 항목 없음 · 첨부 없음(원문 확인 2026-11-27) · 본문만 봄")
  assert.equal(bonusEmptyReason("ok", 0, view("unknown")), "가점 항목 없음 · 첨부 확인 불가")
  assert.equal(bonusEmptyReason("ok", 0, view("present", [{ name: "a.pdf", reason: "image" }], 4)), "가점 항목 없음 · 첨부 4개 중 1개를 읽지 못함")
  assert.equal(bonusEmptyReason("ok", 0, view("present", [{ name: "a.pdf", reason: "partial" }], 4)), "가점 항목 없음")
  assert.equal(bonusEmptyReason("ok", 0, null), "가점 항목 없음")
  assert.equal(bonusEmptyReason("ok", 2, view("none")), null)
  assert.equal(bonusEmptyReason(null, 0, view("none")), null)
  assert.equal(bonusEmptyReason("failed", 0, view("none")), null)
})

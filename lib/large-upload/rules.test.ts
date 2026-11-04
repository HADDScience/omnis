import assert from "node:assert/strict"
import { test } from "node:test"
import { ATTACH_MAX_BYTES, MAX_UPLOAD_BYTES } from "@/lib/constants"
import { attachLimitBytes, blobPathnameFor, classifyNasFailure, isLargeUpload, isTempReadable, nasWaitMs, parseRange, partCount, partRange, remainingLabel, sampleRanges, sanitizeUploadName, segmentCount, segmentRange } from "./rules"

const MiB = 1024 * 1024

test("꺼져 있으면 상한 · 경로가 지금과 같다", () => {
  assert.equal(attachLimitBytes(false), MAX_UPLOAD_BYTES)
  assert.equal(isLargeUpload(300 * MiB, false), false)
  assert.equal(attachLimitBytes(true), ATTACH_MAX_BYTES)
})

test("4MB 까지는 지금 경로, 그 위만 새 경로", () => {
  assert.equal(isLargeUpload(MAX_UPLOAD_BYTES, true), false)
  assert.equal(isLargeUpload(MAX_UPLOAD_BYTES + 1, true), true)
})

test("임시 저장소 경로에 파일 이름이 없다", () => {
  assert.equal(blobPathnameFor("abc"), "uploads/abc/abc")
})

test("경로 문자 · 제어 문자를 이름에서 뺀다", () => {
  assert.equal(sanitizeUploadName("a/../b\\c.pdf"), "a_.._b_c.pdf")
  assert.equal(sanitizeUploadName("a\u0000\nb.txt"), "a__b.txt")
  assert.equal(sanitizeUploadName("  "), "파일")
  assert.equal(sanitizeUploadName(`${"가".repeat(300)}.pdf`).endsWith(".pdf"), true)
  assert.ok(sanitizeUploadName("가".repeat(300)).length <= 200)
})

test("업로드 조각이 파일을 빈틈없이 덮는다", () => {
  const size = 300 * MiB + 7
  const n = partCount(size)
  let at = 0
  for (let p = 1; p <= n; p++) {
    const { start, end } = partRange(p, size)
    assert.equal(start, at)
    at = end
  }
  assert.equal(at, size)
  assert.equal(partCount(5 * MiB), 1)
})

test("복사 단계가 파일을 빈틈없이 덮고 300MB 는 10단계다", () => {
  assert.equal(segmentCount(300 * MiB, 32 * MiB), 10)
  const size = 100 * MiB + 1
  let at = 0
  for (let i = 0; i < segmentCount(size, 32 * MiB); i++) {
    const { start, length } = segmentRange(i, size, 32 * MiB)
    assert.equal(start, at)
    at += length
  }
  assert.equal(at, size)
})

test("표본 범위는 앞 · 가운데 · 끝이고 파일 밖으로 나가지 않는다", () => {
  const ranges = sampleRanges(100 * MiB)
  assert.equal(ranges.length, 3)
  assert.deepEqual(ranges[0], { start: 0, length: MiB })
  assert.equal(ranges[2].start + ranges[2].length, 100 * MiB)
  assert.deepEqual(sampleRanges(100), [{ start: 0, length: 100 }])
})

test("NAS 대기 간격은 5 · 15 · 30 · 60분 뒤 6시간", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 50].map((r) => nasWaitMs(r) / 60_000), [5, 15, 30, 60, 360, 360])
})

test("읽는 곳: VERIFIED 전에는 임시본, 뒤에는 NAS", () => {
  for (const s of ["UPLOADED", "COPYING", "WAITING_NAS", "FAILED"]) assert.equal(isTempReadable(s), true, s)
  for (const s of ["VERIFIED", "TEMP_DELETED"]) assert.equal(isTempReadable(s), false, s)
})

test("Range 해석", () => {
  assert.deepEqual(parseRange("bytes=0-9", 100), { start: 0, end: 9 })
  assert.deepEqual(parseRange("bytes=90-", 100), { start: 90, end: 99 })
  assert.deepEqual(parseRange("bytes=-10", 100), { start: 90, end: 99 })
  assert.deepEqual(parseRange("bytes=90-500", 100), { start: 90, end: 99 })
  assert.deepEqual(parseRange("bytes=-500", 100), { start: 0, end: 99 })
  // 전체로 답한다
  assert.equal(parseRange(null, 100), null)
  assert.equal(parseRange("bytes=0-1,5-6", 100), null)
  assert.equal(parseRange("items=0-1", 100), null)
  assert.equal(parseRange("bytes=-", 100), null)
  assert.equal(parseRange("bytes=9-3", 100), null)
  // 파일 밖
  assert.equal(parseRange("bytes=100-", 100), "unsatisfiable")
  assert.equal(parseRange("bytes=-0", 100), "unsatisfiable")
})

test("NAS 실패 분류 — 모르는 실패는 null(단계 재시도로)", () => {
  assert.equal(classifyNasFailure(Object.assign(new Error("x"), { code: "ECONNREFUSED" })), "nas_down")
  assert.equal(classifyNasFailure(new Error("socket hang up")), "nas_down")
  assert.equal(classifyNasFailure(new Error("시놀로지가 30초 안에 응답하지 않았습니다")), "nas_down")
  assert.equal(classifyNasFailure(new Error("시놀로지 연결이 10초 안에 열리지 않았습니다")), "nas_down")
  assert.equal(classifyNasFailure(new Error("시놀로지 인증서 지문이 일치하지 않습니다. 연결을 중단했습니다.")), "certificate")
  assert.equal(classifyNasFailure(new Error("NAS 쓰기 실패 (HTTP 403)")), null)
  assert.equal(classifyNasFailure("문자열"), null)
})

test("남은 시간 — 처음 몇 초는 비운다", () => {
  assert.equal(remainingLabel(10, 100, 1_000), null)
  assert.equal(remainingLabel(90, 100, 90_000), "1분 안쪽")
  assert.equal(remainingLabel(10, 100, 60_000), "약 9분")
})

/** R2 큰 첨부 규칙. 실행: pnpm test:unit · 실제 저장소(MinIO)로 끝까지: tests/feature/r2-upload.spec.ts */
import assert from "node:assert/strict"
import { test } from "node:test"
import { MAX_SIGN_PARTS, missingParts, partsProblem, r2StorageCapBytes, signablePartNumbers, type R2Part } from "./rules"
import { r2Config, r2UploadEnabled } from "./server"

const MiB = 1024 * 1024
const PART = 16 * MiB
const SIZE = 300 * MiB // 19조각, 마지막은 12MiB

function partsFor(size: number, partBytes = PART): R2Part[] {
  const out: R2Part[] = []
  for (let n = 1, start = 0; start < size; n++, start += partBytes) out.push({ partNumber: n, etag: `"e${n}"`, size: Math.min(partBytes, size - start) })
  return out
}

test("300MB 를 16MiB 로 나누면 19조각이고, 빈틈이 없으면 문제가 없다", () => {
  const parts = partsFor(SIZE)
  assert.equal(parts.length, 19)
  assert.equal(parts[18].size, 12 * MiB)
  assert.equal(partsProblem(parts, SIZE, PART), null)
  assert.deepEqual(missingParts(parts, SIZE, PART), [])
})

test("빠진 조각 · 크기가 틀린 조각 · 파일 밖 조각 · 중복을 잡는다", () => {
  const parts = partsFor(SIZE)
  assert.match(partsProblem(parts.filter((p) => p.partNumber !== 7), SIZE, PART) ?? "", /7번 조각이 없습니다/)
  const short = parts.map((p) => (p.partNumber === 3 ? { ...p, size: p.size - 1 } : p))
  assert.match(partsProblem(short, SIZE, PART) ?? "", /3번 조각의 크기/)
  assert.match(partsProblem([...parts, { partNumber: 20, etag: "x", size: 1 }], SIZE, PART) ?? "", /파일 밖/)
  assert.match(partsProblem([...parts, parts[0]], SIZE, PART) ?? "", /두 번/)
})

test("이어 올리기 — 남은 조각만, 크기가 틀린 조각은 다시", () => {
  const parts = partsFor(SIZE).filter((p) => p.partNumber <= 16)
  assert.deepEqual(missingParts(parts, SIZE, PART), [17, 18, 19])
  const bad = parts.map((p) => (p.partNumber === 2 ? { ...p, size: 5 } : p))
  assert.deepEqual(missingParts(bad, SIZE, PART), [2, 17, 18, 19])
  assert.deepEqual(missingParts([], 5 * MiB, PART), [1])
})

test("서명할 조각 번호 — 정수 · 범위 안 · 중복 없음 · 한 번에 최대 개수", () => {
  assert.deepEqual(signablePartNumbers([1, 2, 19], SIZE, PART), [1, 2, 19])
  for (const bad of [[], [0], [20], [1.5], ["1"], [1, 1], null, "1", Array.from({ length: MAX_SIGN_PARTS + 1 }, (_, i) => i + 1)])
    assert.equal(signablePartNumbers(bad, SIZE, PART), null, JSON.stringify(bad))
})

test("설정 — 값이 하나라도 없으면 R2 가 아니다. 플래그가 꺼져 있어도 아니다", () => {
  const full = { LARGE_UPLOAD_BACKEND: "r2", R2_ACCOUNT_ID: "acc", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b" }
  assert.equal(r2Config(full)?.endpoint, "https://acc.r2.cloudflarestorage.com")
  assert.equal(r2UploadEnabled(full), true)
  assert.equal(r2Config({ ...full, R2_ENDPOINT: "http://127.0.0.1:9100" })?.endpoint, "http://127.0.0.1:9100")
  for (const missing of ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_ACCOUNT_ID"]) {
    const env: Record<string, string | undefined> = { ...full, [missing]: undefined }
    assert.equal(r2Config(env), null, missing)
    assert.equal(r2UploadEnabled(env), false, missing)
  }
  assert.equal(r2UploadEnabled({ ...full, LARGE_UPLOAD_BACKEND: undefined }), false)
  assert.equal(r2UploadEnabled({ ...full, LARGE_UPLOAD_BACKEND: "blob" }), false)
  assert.notEqual(r2Config({ ...full, LARGE_UPLOAD_BACKEND: undefined }), null, "끈 뒤에도 이미 올린 파일은 읽는다")
})

test("저장 상한 — 기본 9,000MB(무료 10GB 아래)", () => {
  assert.equal(r2StorageCapBytes({}), 9_000 * MiB)
  assert.equal(r2StorageCapBytes({ R2_STORAGE_CAP_MB: "100" }), 100 * MiB)
})

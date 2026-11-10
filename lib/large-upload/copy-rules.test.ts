import assert from "node:assert/strict"
import { test } from "node:test"
import { copyOneSegment, verifyBeforeDelete } from "./copy-rules"

const data = Buffer.from("조각 내용")
const ok = { readTemp: async () => data, writeNas: async () => 201, readNas: async () => Buffer.from(data) }

test("되읽은 내용이 같으면 ok 이고 해시를 잇는다", async () => {
  const a = await copyOneSegment(ok, null)
  const b = await copyOneSegment(ok, a.kind === "ok" ? a.manifest : null)
  assert.equal(a.kind, "ok")
  assert.equal(b.kind, "ok")
  assert.notEqual(a.kind === "ok" && a.manifest, b.kind === "ok" && b.manifest)
})

test("거부: 되읽은 내용이 다르거나 범위를 안 주면 ok 가 아니다", async () => {
  assert.equal((await copyOneSegment({ ...ok, readNas: async () => Buffer.from("다른 내용") }, null)).kind, "mismatch")
  assert.equal((await copyOneSegment({ ...ok, readNas: async () => null }, null)).kind, "mismatch")
})

test("임시본이 없으면 NAS 를 건드리지 않는다", async () => {
  let wrote = false
  const out = await copyOneSegment({ ...ok, readTemp: async () => "missing", writeNas: async () => { wrote = true; return 201 } }, null)
  assert.equal(out.kind, "blob_missing")
  assert.equal(wrote, false)
})

test("NAS 쓰기 실패의 종류를 가른다", async () => {
  assert.equal((await copyOneSegment({ ...ok, writeNas: async () => 507 }, null)).kind, "disk_full")
  assert.equal((await copyOneSegment({ ...ok, writeNas: async () => 503 }, null)).kind, "nas_down")
  assert.equal((await copyOneSegment({ ...ok, writeNas: async () => { throw Object.assign(new Error("x"), { code: "ETIMEDOUT" }) } }, null)).kind, "nas_down")
  assert.equal((await copyOneSegment({ ...ok, writeNas: async () => { throw new Error("시놀로지 인증서 지문이 일치하지 않습니다") } }, null)).kind, "certificate")
  // 권한 문제 같은 것은 숨기지 않고 던져 단계 재시도 · 알림으로 간다
  await assert.rejects(copyOneSegment({ ...ok, writeNas: async () => 403 }, null), /403/)
})

const SIZE = 3 * 1024 * 1024
const whole = Buffer.alloc(SIZE, 7)
const slice = async (start: number, length: number) => whole.subarray(start, start + length)
const good = { statNas: async () => SIZE, readTemp: slice, readNas: slice }

test("크기와 표본이 같을 때만 지운다", async () => {
  assert.deepEqual(await verifyBeforeDelete(good, SIZE), { kind: "ok" })
})

test("거부: 크기가 다르면 지우지 않는다", async () => {
  assert.equal((await verifyBeforeDelete({ ...good, statNas: async () => SIZE - 1 }, SIZE)).kind, "bad")
  assert.equal((await verifyBeforeDelete({ ...good, statNas: async () => null }, SIZE)).kind, "bad")
})

test("거부: 표본 중 하나라도 다르면 지우지 않는다", async () => {
  // 끝 범위만 다른 경우 — NAS 가 앞부분을 캐시로 답해도 잡는다
  const nasBadTail = async (start: number, length: number) => (start + length === SIZE && start > 0 ? Buffer.alloc(length, 9) : slice(start, length))
  assert.equal((await verifyBeforeDelete({ ...good, readNas: nasBadTail }, SIZE)).kind, "bad")
  assert.equal((await verifyBeforeDelete({ ...good, readNas: async () => null }, SIZE)).kind, "bad")
  assert.equal((await verifyBeforeDelete({ ...good, readTemp: async () => "missing" as const }, SIZE)).kind, "bad")
})

test("NAS 가 꺼졌으면 판단하지 않고 다시 본다", async () => {
  const down = async () => { throw Object.assign(new Error("x"), { code: "ECONNREFUSED" }) }
  assert.equal((await verifyBeforeDelete({ ...good, statNas: down }, SIZE)).kind, "retry")
})

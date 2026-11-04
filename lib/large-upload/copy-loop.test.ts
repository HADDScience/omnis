import assert from "node:assert/strict"
import { test } from "node:test"
import { runCopy, type CopyOps, type CopyResult } from "./copy-loop"
import { TEMP_DELETE_DELAY_MS } from "./rules"

/** 시계를 sleep 이 움직이는 가짜 단계 묶음. log 로 무슨 일이 일어났는지 본다 */
function ops(over: Partial<CopyOps> & { segments?: number; segmentsDone?: number; state?: string } = {}) {
  let clock = 1_000_000
  const log: string[] = []
  const { segments = 3, segmentsDone = 0, state = "UPLOADED", ...rest } = over
  const base: CopyOps = {
    now: () => clock,
    sleep: async (ms) => { clock += ms; log.push(`sleep:${ms}`) },
    loadCopyPlan: async () => ({ state, segments, segmentsDone, manifestSha256: null }),
    claimCopySlot: async () => { log.push("claim"); return true },
    copySegment: async (i) => { log.push(`copy:${i}`); return { kind: "ok", manifest: `m${i}` } },
    recordProgress: async (n) => { log.push(`progress:${n}`) },
    markWaiting: async (n, _m, r) => { log.push(`waiting:${n}:${r}`) },
    probeNas: async () => { log.push("probe"); return true },
    verifyWholeSize: async () => { log.push("size"); return { ok: true, expected: 1, actual: 1 } },
    markVerified: async (n) => { log.push(`verified:${n}`) },
    failTransfer: async (r) => { log.push(`fail:${r}`) },
    alert: async (r) => { log.push(`alert:${r}`) },
    deleteTemp: async () => { log.push("delete"); return "TEMP_DELETED" },
  }
  return { ops: { ...base, ...rest }, log, advance: (ms: number) => { clock += ms } }
}

const has = (log: string[], prefix: string) => log.some((l) => l.startsWith(prefix))

test("정상: 조각 → 크기 대조 → VERIFIED → 15분 뒤 삭제 순서", async () => {
  const { ops: o, log } = ops()
  assert.equal(await runCopy(o), "TEMP_DELETED")
  assert.deepEqual(log, ["claim", "copy:0", "copy:1", "copy:2", "size", "verified:3", `sleep:${TEMP_DELETE_DELAY_MS}`, "delete"])
})

test("이어 가기: 끝난 조각부터 시작한다", async () => {
  const { ops: o, log } = ops({ segments: 3, segmentsDone: 2 })
  await runCopy(o)
  assert.ok(!log.includes("copy:0"))
  assert.ok(log.includes("copy:2"))
})

test("4조각마다 진척을 적는다", async () => {
  const { ops: o, log } = ops({ segments: 9 })
  await runCopy(o)
  assert.deepEqual(log.filter((l) => l.startsWith("progress")), ["progress:4", "progress:8"])
})

test("이미 VERIFIED 면 복사하지 않고 삭제로 간다", async () => {
  const { ops: o, log } = ops({ state: "VERIFIED" })
  await runCopy(o)
  assert.ok(!has(log, "copy"))
  assert.ok(log.includes("delete"))
})

test("끝난 전송은 다시 건드리지 않는다", async () => {
  for (const state of ["TEMP_DELETED", "FAILED"]) {
    const { ops: o, log } = ops({ state })
    assert.equal(await runCopy(o), state)
    assert.deepEqual(log, [])
  }
})

test("거부: 해시가 3번 다르면 FAILED, 임시본을 지우지 않는다", async () => {
  const { ops: o, log } = ops({ copySegment: async () => ({ kind: "mismatch" }) })
  assert.equal(await runCopy(o), "FAILED")
  assert.ok(has(log, "fail:"))
  assert.ok(!log.includes("delete"))
  assert.ok(!has(log, "verified"))
})

test("거부: 전체 크기가 다르면 VERIFIED 가 되지 않는다", async () => {
  const { ops: o, log } = ops({ verifyWholeSize: async () => ({ ok: false, expected: 10, actual: 9 }) })
  assert.equal(await runCopy(o), "FAILED")
  assert.ok(!has(log, "verified"))
  assert.ok(!log.includes("delete"))
})

test("거부: 원본이 없으면 FAILED", async () => {
  const { ops: o, log } = ops({ copySegment: async () => ({ kind: "blob_missing" }) })
  assert.equal(await runCopy(o), "FAILED")
  assert.ok(!log.includes("delete"))
})

test("NAS 가 꺼지면 기다렸다 그 조각부터 이어 가고, 곧 돌아오면 알리지 않는다", async () => {
  let calls = 0
  const { ops: o, log } = ops({
    copySegment: async (i) => {
      log2.push(`copy:${i}`)
      return ++calls === 2 ? ({ kind: "nas_down" } as CopyResult) : { kind: "ok", manifest: `m${i}` }
    },
  })
  const log2: string[] = []
  assert.equal(await runCopy(o), "TEMP_DELETED")
  assert.deepEqual(log2, ["copy:0", "copy:1", "copy:1", "copy:2"])
  assert.ok(log.includes("waiting:1:nas_down"))
  assert.ok(!has(log, "alert"))
})

test("단계가 끝내 던져도 임시본을 지우지 않고 기다린다", async () => {
  let thrown = false
  const { ops: o, log } = ops({
    copySegment: async (i) => {
      if (!thrown) { thrown = true; throw new Error("HTTP 403") }
      return { kind: "ok", manifest: `m${i}` }
    },
  })
  assert.equal(await runCopy(o), "TEMP_DELETED")
  assert.ok(log.includes("waiting:0:nas_down"))
})

test("NAS 대기: 1시간째 한 번 알리고 이후 매일, 깨어나도 DB 단계를 부르지 않는다", async () => {
  let up = false
  let probes = 0
  let down = true
  const { ops: o, log } = ops({
    copySegment: async (i) => (down ? (down = false, { kind: "nas_down" }) : { kind: "ok", manifest: `m${i}` }),
    probeNas: async () => { if (++probes >= 13) up = true; return up },
  })
  await runCopy(o)
  const alerts = log.filter((l) => l.startsWith("alert"))
  // 5·15·30·60 뒤 6시간씩: 110분에 1회, 그 뒤 24시간마다(13번째 확인에서 돌아온다)
  assert.equal(alerts.length, 3)
  // 대기 동안 기록은 markWaiting 한 번뿐이다
  assert.equal(log.filter((l) => l.startsWith("waiting")).length, 1)
})

test("지문 · 디스크 문제는 바로 알린다", async () => {
  for (const kind of ["certificate", "disk_full"] as const) {
    let first = true
    const { ops: o, log } = ops({ copySegment: async (i) => (first ? (first = false, { kind }) : { kind: "ok", manifest: `m${i}` }) })
    await runCopy(o)
    const waiting = log.findIndex((l) => l.startsWith("waiting"))
    assert.ok(log[waiting + 1].startsWith("alert"), kind)
  }
})

test("30일을 넘기면 FAILED 로 두고 임시본을 지우지 않는다", async () => {
  const { ops: o, log } = ops({ copySegment: async () => ({ kind: "nas_down" }), probeNas: async () => false })
  assert.equal(await runCopy(o), "FAILED")
  assert.ok(has(log, "fail:"))
  assert.ok(!log.includes("delete"))
})

test("자리가 없으면 기다린다", async () => {
  let n = 0
  const { ops: o, log } = ops({ claimCopySlot: async () => ++n >= 3 })
  await runCopy(o)
  assert.equal(log.filter((l) => l === "sleep:60000").length, 2)
})

test("삭제 직전 NAS 가 꺼졌으면 기다렸다 다시 본다", async () => {
  let n = 0
  const { ops: o } = ops({ deleteTemp: async () => (++n < 3 ? "retry" : "TEMP_DELETED") })
  assert.equal(await runCopy(o), "TEMP_DELETED")
  assert.equal(n, 3)
})

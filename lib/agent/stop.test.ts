/** 「답변 중지」 API 규칙 — 내 실행만 · RUNNING 일 때만 · 한 번만. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { stopRun, type StopDeps } from "./stop"

/** 표 하나짜리 흉내 DB — stopIfRunning 은 조건부 갱신(status=RUNNING 인 행만)처럼 군다 */
function fakeDb(rows: { id: string; userId: string; status: string; workflowRunId: string | null }[]) {
  const signals: string[] = []
  const deps: StopDeps = {
    findRun: async (id, userId) => {
      const r = rows.find((x) => x.id === id && x.userId === userId)
      return r ? { status: r.status, workflowRunId: r.workflowRunId } : null
    },
    stopIfRunning: async (id, userId) => {
      // 읽고 바꾸는 사이에 다른 요청이 끼어들 수 있게 한 박자 쉰다 — 그래도 하나만 바뀌어야 한다
      await new Promise((r) => setTimeout(r, 1))
      const r = rows.find((x) => x.id === id && x.userId === userId && x.status === "RUNNING")
      if (!r) return 0
      r.status = "STOPPED"
      return 1
    },
    signal: async (wf) => {
      signals.push(wf)
    },
  }
  return { rows, deps, signals }
}

test("답하는 중인 내 실행 — STOPPED 로 바꾸고 그 Workflow 에 멈춤 신호를 보낸다", async () => {
  const db = fakeDb([{ id: "r1", userId: "u1", status: "RUNNING", workflowRunId: "wf1" }])
  assert.deepEqual(await stopRun("r1", "u1", db.deps), { ok: true, status: "STOPPED" })
  assert.equal(db.rows[0].status, "STOPPED")
  assert.deepEqual(db.signals, ["wf1"])
})

test("거부 — 남의 실행은 없는 실행과 같다(404). 상태도 신호도 그대로", async () => {
  const db = fakeDb([{ id: "r1", userId: "u1", status: "RUNNING", workflowRunId: "wf1" }])
  const r = await stopRun("r1", "u2", db.deps)
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.status, 404)
  assert.equal(db.rows[0].status, "RUNNING")
  assert.deepEqual(db.signals, [])
  assert.equal((await stopRun("없음", "u1", db.deps)).ok, false)
})

test("거부 — 이미 끝났거나 확인을 기다리는 실행은 409 · 상태를 바꾸지 않는다(DONE 을 STOPPED 로 덮지 않는다)", async () => {
  for (const status of ["DONE", "FAILED", "LIMIT", "AWAITING_APPROVAL", "CANCELLED", "STOPPED"]) {
    const db = fakeDb([{ id: "r1", userId: "u1", status, workflowRunId: "wf1" }])
    const r = await stopRun("r1", "u1", db.deps)
    assert.equal(!r.ok && r.status, 409, status)
    assert.equal(db.rows[0].status, status, status)
    assert.deepEqual(db.signals, [], status)
  }
})

test("동시에 두 번 눌러도 한 번만 멈춘다 — 하나는 200, 하나는 409", async () => {
  const db = fakeDb([{ id: "r1", userId: "u1", status: "RUNNING", workflowRunId: "wf1" }])
  const [a, b] = await Promise.all([stopRun("r1", "u1", db.deps), stopRun("r1", "u1", db.deps)])
  assert.deepEqual([a.ok, b.ok].sort(), [false, true])
  assert.deepEqual(db.signals, ["wf1"])
})

test("Workflow id 가 아직 없으면(막 연 실행) 상태만 바꾼다 — 첫 단계가 STOPPED 를 보고 열리지 않는다", async () => {
  const db = fakeDb([{ id: "r1", userId: "u1", status: "RUNNING", workflowRunId: null }])
  assert.equal((await stopRun("r1", "u1", db.deps)).ok, true)
  assert.equal(db.rows[0].status, "STOPPED")
  assert.deepEqual(db.signals, [])
})

/** 지원서 단계 바꾸기 — 가짜 db 로 돈다. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import { changeApplicationStage } from "./stage"

function fakeDb(row: { id: string; code: string; stage: string } | null, opts: { raced?: boolean } = {}) {
  const calls: { op: string; data?: unknown }[] = []
  const tx = {
    jobApplication: {
      updateMany: async (a: { where: unknown; data: unknown }) => {
        calls.push({ op: "update", data: a })
        return { count: opts.raced ? 0 : 1 }
      },
    },
    jobApplicationEvent: { create: async (a: { data: unknown }) => (calls.push({ op: "event", data: a.data }), a.data) },
    activityLog: { create: async (a: { data: unknown }) => (calls.push({ op: "log", data: a.data }), a.data) },
  }
  const db = {
    jobApplication: { findUnique: async () => row },
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  }
  return { db: db as unknown as NonNullable<Parameters<typeof changeApplicationStage>[3]>["db"], calls }
}

const app = { id: "a1", code: "APP261125-001", stage: "RECEIVED" }

test("단계 바꾸기 — 지원서 · 이벤트 · 활동 기록을 남기고, 메일을 보내는 경로는 없다", async () => {
  const { db, calls } = fakeDb(app)
  const r = await changeApplicationStage("u1", "a1", "INTERVIEW", { note: "서류 합격", db })
  assert.deepEqual(r, { ok: true, id: "a1", code: "APP261125-001", from: "RECEIVED", to: "INTERVIEW" })
  assert.deepEqual(calls.map((c) => c.op), ["update", "event", "log"])
  assert.deepEqual(calls[0].data, { where: { id: "a1", stage: "RECEIVED" }, data: { stage: "INTERVIEW" } })
  assert.deepEqual(calls[1].data, { applicationId: "a1", actorId: "u1", fromStage: "RECEIVED", toStage: "INTERVIEW", note: "서류 합격" })
  assert.equal((calls[2].data as { action: string }).action, "hr.application.stage")
})

test("최종 합격 · 불합격 · 철회는 결정 시각을 찍는다", async () => {
  const { db, calls } = fakeDb({ ...app, stage: "INTERVIEW" })
  await changeApplicationStage("u1", "a1", "HIRED", { db })
  assert.ok((calls[0].data as { data: { decidedAt?: Date } }).data.decidedAt instanceof Date)
})

test("거절 — 모르는 단계 · RECEIVING · 같은 단계 · 없는 지원서 · 그새 바뀐 지원서", async () => {
  for (const bad of ["RECEIVING", "interview", "", 3, null]) {
    const { db, calls } = fakeDb(app)
    const r = await changeApplicationStage("u1", "a1", bad, { db })
    assert.equal(r.ok ? 0 : r.status, 400, String(bad))
    assert.equal(calls.length, 0)
  }
  assert.equal((await changeApplicationStage("u1", "a1", "RECEIVED", { db: fakeDb(app).db })).ok, false)
  const none = await changeApplicationStage("u1", "a1", "INTERVIEW", { db: fakeDb(null).db })
  assert.equal(none.ok ? 0 : none.status, 404)
  const receiving = await changeApplicationStage("u1", "a1", "INTERVIEW", { db: fakeDb({ ...app, stage: "RECEIVING" }).db })
  assert.equal(receiving.ok ? 0 : receiving.status, 404)
  const raced = fakeDb(app, { raced: true })
  const r = await changeApplicationStage("u1", "a1", "INTERVIEW", { db: raced.db })
  assert.equal(r.ok ? 0 : r.status, 409)
  assert.deepEqual(raced.calls.map((c) => c.op), ["update"])
})

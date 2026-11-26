/**
 * 국가과제 결정 내리기(removeGrantDecision) — DB 대신 가짜 db 를 넣어 돈다. 실행: pnpm test:unit
 * 지키는 것: 올린 결정은 담당자 · 결정을 지우고 활동 기록을 남긴다 / 노션에서 옮겨 온 결정은 지우지 않는다 / 로그인 없으면 거절
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { isImportedDecision, removeGrantDecision } from "./grants"

type Row = {
  id: string
  title: string
  externalKey: string
  stage: string
  owners: { user: { name: string } }[]
}

function fakeDb(row: Row | null) {
  const calls: string[] = []
  const logs: Record<string, unknown>[] = []
  const tx = {
    grantDecisionOwner: {
      deleteMany: async (a: { where: { decisionId: string } }) => {
        calls.push(`owners.deleteMany:${a.where.decisionId}`)
        return { count: row?.owners.length ?? 0 }
      },
    },
    grantDecision: {
      delete: async (a: { where: { id: string } }) => {
        calls.push(`decision.delete:${a.where.id}`)
        return row
      },
    },
    activityLog: {
      create: async (a: { data: Record<string, unknown> }) => {
        calls.push("activity.create")
        logs.push(a.data)
        return a.data
      },
    },
  }
  const db = {
    grantDecision: {
      findUnique: async (a: { where: { id: string } }) => {
        calls.push(`decision.findUnique:${a.where.id}`)
        return row && row.id === a.where.id ? row : null
      },
    },
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  }
  return {
    db: db as unknown as Parameters<typeof removeGrantDecision>[2],
    calls,
    logs,
  }
}

const raised: Row = {
  id: "d-raised",
  title: "2026 경기 바이오 실증 지원",
  externalKey: "notice:bizinfo:PBLN_000123",
  stage: "PREPARING",
  owners: [{ user: { name: "정우창" } }],
}
const imported: Row = {
  ...raised,
  id: "d-notion",
  externalKey: "notion:1f2e3d4c",
}

test("올린 결정 — 담당자 · 결정을 지우고, 누가 내렸는지 활동 기록에 남긴다", async () => {
  const { db, calls, logs } = fakeDb(raised)
  const r = await removeGrantDecision("u-1", raised.id, db)
  assert.ok(r.ok)
  assert.equal(r.value.title, raised.title)
  assert.deepEqual(calls, [
    "decision.findUnique:d-raised",
    "owners.deleteMany:d-raised",
    "decision.delete:d-raised",
    "activity.create",
  ])
  assert.equal(logs[0].userId, "u-1")
  assert.equal(logs[0].action, "grant.decision.removed")
  assert.equal(logs[0].entityId, raised.id)
  assert.deepEqual((logs[0].metadata as { owners: string[] }).owners, ["정우창"])
})

test("노션에서 옮겨 온 결정 — 지우지 않고 중단을 권한다", async () => {
  assert.equal(isImportedDecision(imported), true)
  assert.equal(isImportedDecision(raised), false)
  const { db, calls } = fakeDb(imported)
  const r = await removeGrantDecision("u-1", imported.id, db)
  assert.ok(!r.ok)
  assert.equal(r.status, 409)
  assert.match(r.error, /중단/)
  assert.deepEqual(calls, ["decision.findUnique:d-notion"])
})

test("로그인 없음 — DB 를 읽기 전에 거절한다", async () => {
  for (const who of [null, undefined, ""]) {
    const { db, calls } = fakeDb(raised)
    const r = await removeGrantDecision(who, raised.id, db)
    assert.ok(!r.ok)
    assert.equal(r.status, 401)
    assert.deepEqual(calls, [])
  }
})

test("없는 결정 — 404, 아무것도 지우지 않는다", async () => {
  const { db, calls } = fakeDb(null)
  const r = await removeGrantDecision("u-1", "nope", db)
  assert.ok(!r.ok)
  assert.equal(r.status, 404)
  assert.deepEqual(calls, ["decision.findUnique:nope"])
})

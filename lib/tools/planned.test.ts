/**
 * 계획을 먼저 세우는 쓰기(#248) — confirm 이 없으면 쓰지 않고, 막힌 계획은 실행하지 않는다. 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { planText, runPlanned, type Planner } from "./planned"
import type { Caller } from "../omnis-mcp"
import { TOOL_POLICY } from "./registry"
import { EXTRA_TOOLS } from "./defs"
import { WORK_READ_NAMES } from "./defs-work"
import { CRM_MORE_READ_NAMES } from "./defs-crm"
import { CARD_READ_NAMES } from "./defs-cards"
import { ADMIN_READ_NAMES } from "./defs-admin"
import { IP_MORE_READ_NAMES } from "./defs-ip"

const caller: Caller = { userId: "u1", name: "시험 사용자", role: "MEMBER", ip: null }

function counting(problem?: string): { planner: Planner; runs: () => number } {
  let n = 0
  const planner: Planner = async () => ({
    title: "시험 쓰기", target: "대상", risk: "따라오는 일",
    changes: [{ label: "값", before: "1", after: "2" }, { label: "새 줄", before: null, after: "가" }],
    ...(problem ? { problem } : {}),
    run: async () => { n++; return { ok: true, text: "썼습니다" } },
  })
  return { planner, runs: () => n }
}

test("confirm 이 없으면 쓰지 않고 바뀔 내용만 돌려준다", async () => {
  const { planner, runs } = counting()
  const r = await runPlanned(planner, {}, caller)
  assert.equal(runs(), 0)
  assert.ok("text" in r && r.text.includes("아직 쓰지 않았습니다") && r.text.includes("값: 1 → 2") && r.text.includes("새 줄: 가"))
})

test("confirm=true 면 한 번 쓴다 — 문자열 \"true\" 는 확인이 아니다", async () => {
  const { planner, runs } = counting()
  await runPlanned(planner, { confirm: "true" }, caller)
  assert.equal(runs(), 0)
  const r = await runPlanned(planner, { confirm: true }, caller)
  assert.equal(runs(), 1)
  assert.ok("text" in r && r.text.startsWith("썼습니다"))
})

test("막힌 계획(권한 · 없는 대상)은 confirm 이 있어도 실행하지 않는다", async () => {
  const { planner, runs } = counting("내가 참여자가 아닌 방입니다")
  const r = await runPlanned(planner, { confirm: true }, caller)
  assert.equal(runs(), 0)
  assert.deepEqual(r, { error: "내가 참여자가 아닌 방입니다" })
})

test("planText — 전 → 뒤, 새 줄은 뒤만, 경고", () => {
  const t = planText({ title: "T", target: "X", risk: "R", warning: "W", changes: [{ label: "a", before: "1", after: "2" }, { label: "b", before: null, after: "3" }] })
  assert.equal(t, "T — X\n- a: 1 → 2\n- b: 3\n⚠ W\n(R)")
})

test("묶음 쓰기 도구는 모두 confirm 칸이 있고 레지스트리에서 confirm: param 이다", () => {
  const reads = new Set<string>([...WORK_READ_NAMES, ...CRM_MORE_READ_NAMES, ...CARD_READ_NAMES, ...ADMIN_READ_NAMES, ...IP_MORE_READ_NAMES])
  for (const t of EXTRA_TOOLS) {
    const p = (TOOL_POLICY as Record<string, { confirm?: string; agent: unknown; ask: unknown }>)[t.name]
    assert.ok(p, `${t.name} 레지스트리`)
    if (reads.has(t.name)) {
      assert.equal(p.agent, "read", t.name)
      continue
    }
    assert.ok("confirm" in (t.inputSchema.properties as Record<string, unknown>), `${t.name} confirm 칸`)
    assert.equal(p.confirm, "param", t.name)
    assert.equal(p.agent, "write", t.name)
    assert.equal(p.ask, "preview", t.name)
  }
})

/**
 * 관리자만인 화면의 일은 도구도 관리자만(#248) — 일반 구성원이 부르면 계획이 막히고 실행 함수가 없다. 실행: pnpm test:unit
 * 권한 확인이 DB 를 읽기 전에 일어나므로 DB 없이 돈다.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import type { Caller } from "../omnis-mcp"
import { ADMIN_PLANNERS, runAdminRead } from "./plan-admin"

const member: Caller = { userId: "u-member", name: "시험 구성원", role: "MEMBER", ip: null }
const ADMIN_ONLY_WRITES = ["update_company_profile", "save_company_year", "delete_company_year", "set_calendar_audience", "set_ai_budget", "set_feature_status"] as const

const ARGS: Record<string, Record<string, unknown>> = {
  update_company_profile: { name_ko: "바꿀 상호" },
  save_company_year: { year: 2026, basis: "PLANNED", revenue_krw: "1" },
  delete_company_year: { year: 2026, basis: "PLANNED" },
  set_calendar_audience: { calendar: "아무 캘린더", audience: "ALL" },
  set_ai_budget: { monthly_krw: 1000 },
  set_feature_status: { request: "r1", status: "DONE" },
}

test("관리자만인 쓰기 — 일반 구성원은 계획이 막히고 실행할 수 없다", async () => {
  for (const name of ADMIN_ONLY_WRITES) {
    const p = await ADMIN_PLANNERS[name](ARGS[name], member)
    assert.ok(p.problem?.includes("관리자만"), `${name}: ${p.problem}`)
    assert.equal(p.run, undefined, name)
  }
})

test("관리자만인 읽기 — 일반 구성원에게는 거절", async () => {
  for (const name of ["ai_budget", "list_feature_requests", "ai_survey_results"] as const) {
    const r = await runAdminRead(name, {}, member)
    assert.ok("error" in r && r.error.includes("관리자만"), name)
  }
})

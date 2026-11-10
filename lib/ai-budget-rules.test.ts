import { test } from "node:test"
import assert from "node:assert/strict"
import {
  budgetDefaults, budgetRefusal, dueAlertLevels, kstDayKey, kstMonthKey, kstMonthStart, mergeBudget, percentOf, suggestRaise, userDailyLimit,
} from "./ai-budget-rules"

test("기본값 — env 없으면 1인 하루 1,000원 · 월 110,000원, env 로 바꾼다", () => {
  assert.deepEqual(budgetDefaults({}), { userDailyKrw: 1000, monthlyKrw: 110000, users: {} })
  assert.deepEqual(budgetDefaults({ OMNIS_AI_USER_DAILY_KRW: "1500", OMNIS_AI_MONTHLY_KRW: " 200000 " }), { userDailyKrw: 1500, monthlyKrw: 200000, users: {} })
  assert.equal(budgetDefaults({ OMNIS_AI_USER_DAILY_KRW: "-1" }).userDailyKrw, 1000)
  assert.equal(budgetDefaults({ OMNIS_AI_MONTHLY_KRW: "abc" }).monthlyKrw, 110000)
})

test("관리자 화면 값이 기본값을 덮고, 틀린 칸은 버린다", () => {
  const d = budgetDefaults({})
  assert.deepEqual(mergeBudget(d, null), d)
  const m = mergeBudget(d, { userDailyKrw: 2000, monthlyKrw: "x", users: { a: 3000, b: 0, c: "500" } })
  assert.deepEqual(m, { userDailyKrw: 2000, monthlyKrw: 110000, users: { a: 3000, c: 500 } })
  assert.equal(userDailyLimit(m, "a"), 3000)
  assert.equal(userDailyLimit(m, "z"), 2000)
})

test("월 상한이 먼저 — 닿으면 사람별 상한과 무관하게 막는다", () => {
  const b = mergeBudget(budgetDefaults({}), { users: { a: 5000 } })
  const r = budgetRefusal({ userTodayKrw: 0, monthKrw: 110000 }, b, { userId: "a", isAdmin: false })
  assert.equal(r?.budget.kind, "monthly")
  assert.equal(r?.budget.canRaise, false)
  assert.match(r!.error, /관리자에게/)
})

test("사람별 하루 상한 — 예외 상한을 따르고, 관리자면 올리기 단추", () => {
  const b = mergeBudget(budgetDefaults({}), { users: { a: 5000 } })
  assert.equal(budgetRefusal({ userTodayKrw: 4999, monthKrw: 0 }, b, { userId: "a", isAdmin: false }), null)
  const r = budgetRefusal({ userTodayKrw: 5000, monthKrw: 0 }, b, { userId: "a", isAdmin: true })
  assert.equal(r?.status, 429)
  assert.equal(r?.budget.kind, "user_daily")
  assert.equal(r?.budget.limitKrw, 5000)
  assert.equal(r?.budget.canRaise, true)
  assert.equal(r?.budget.userId, "a")
  assert.equal(r?.budget.suggestKrw, 7500)
  assert.match(r!.error, /오늘 AI 사용 한도/)
  assert.ok(budgetRefusal({ userTodayKrw: 1000, monthKrw: 0 }, b, { userId: "b", isAdmin: false }))
})

test("올리기 제안 — 1.5배를 단위에 맞춰 올림, 적어도 한 단위", () => {
  assert.equal(suggestRaise("user_daily", 1000), 1500)
  assert.equal(suggestRaise("user_daily", 1200), 2000)
  assert.equal(suggestRaise("monthly", 110000), 170000)
  assert.equal(suggestRaise("user_daily", 100), 600)
})

test("알림 단계 — 80% · 100%, 이미 보낸 단계는 다시 내지 않는다", () => {
  assert.deepEqual(dueAlertLevels(87_999, 110_000, []), [])
  assert.deepEqual(dueAlertLevels(88_000, 110_000, []), [80])
  assert.deepEqual(dueAlertLevels(120_000, 110_000, []), [80, 100])
  assert.deepEqual(dueAlertLevels(120_000, 110_000, [80]), [100])
  assert.deepEqual(dueAlertLevels(120_000, 110_000, [80, 100]), [])
  assert.deepEqual(dueAlertLevels(1, 0, []), [])
})

test("한국 시각 달 · 날 — 1일 0시(KST)가 경계", () => {
  // 2026-10-31 15:30 UTC = 11-01 00:30 KST
  const t = new Date("2026-10-31T15:30:00Z")
  assert.equal(kstMonthKey(t), "2026-11")
  assert.equal(kstMonthStart(t).toISOString(), "2026-10-31T15:00:00.000Z")
  assert.equal(kstDayKey(t), "2026-11-01")
  assert.equal(kstMonthKey(new Date("2026-10-31T14:59:00Z")), "2026-10")
})

test("상한 대비 %", () => {
  assert.equal(percentOf(800, 1000), 80)
  assert.equal(percentOf(1, 0), null)
})

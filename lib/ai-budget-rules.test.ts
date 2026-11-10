import { test } from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_RUN_COST, quantile, runCostBasis, runsFor, runsLabel,
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

test("환산 기준 — 표본 20건 미만이면 기본값(보통 16.9 · 긴 작업 54) + 추정", () => {
  const b = runCostBasis(Array.from({ length: 19 }, () => 10))
  assert.deepEqual(b, { ...DEFAULT_RUN_COST, samples: 19, estimated: true })
  assert.equal(runCostBasis([0, -1, Number.NaN]).samples, 0)
})

test("환산 기준 — 20건 이상이면 중앙값 · 90%값 실측", () => {
  const xs = Array.from({ length: 21 }, (_, i) => i + 1) // 1..21
  const b = runCostBasis(xs.reverse())
  assert.equal(b.estimated, false)
  assert.equal(b.samples, 21)
  assert.equal(b.typical, 11)
  assert.equal(b.long, 19)
  assert.equal(quantile([1, 2], 0.5), 1.5)
})

test("원 → 대화 수 — 하루 1,000원 ≈ 보통 59번 · 긴 작업 18번, 월 11만원 ≈ 보통 6,508번", () => {
  const b = runCostBasis([])
  assert.deepEqual(runsFor(1000, b), { typical: 59, long: 18 })
  assert.equal(runsFor(110_000, b).typical, 6508)
  assert.deepEqual(runsFor(-5, b), { typical: 0, long: 0 })
  assert.equal(runsLabel(1000, b), "옴니스 대화 약 59번(보통) · 긴 작업 약 18번")
  assert.equal(runsLabel(110_000, b, true), "보통 약 6,508번 · 긴 작업 약 2,037번")
})

test("한도 도달 안내에 대화 수가 붙고, 기준을 화면에 넘긴다", () => {
  const basis = runCostBasis([])
  const r = budgetRefusal({ userTodayKrw: 1000, monthKrw: 0 }, budgetDefaults({}), { userId: "a", isAdmin: false }, basis)
  assert.match(r!.error, /1,000원 · 보통 대화 약 59번\(추정\)/)
  assert.equal(r!.budget.basis?.typical, 16.9)
  // 기준 없이 부르면 예전 문장 그대로
  assert.doesNotMatch(budgetRefusal({ userTodayKrw: 1000, monthKrw: 0 }, budgetDefaults({}), { userId: "a", isAdmin: false })!.error, /보통 대화/)
})

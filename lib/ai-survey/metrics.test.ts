import { test } from "node:test"
import assert from "node:assert/strict"
import { MIN_RESPONSES, companySummary, computeMetrics, intensityOf, latencyTable, projectTotal, sizeOfMinutes, summaryText, taskShares, tokensLabel } from "./metrics"
import type { Facts } from "./rules"

const f = (turnId: string, rest: object) => ({ turnId, ...rest })

const HEAVY: Facts = {
  daysPerWeek: f("t1", { num: 5 }),
  hoursPerDay: f("t1", { num: 3 }),
  tools: f("t2", { labels: ["Claude", "ChatGPT"] }),
  payer: f("t3", { values: ["personal"], labels: ["내가 냄"] }),
  monthlyFeeKrw: f("t4", { num: 30000 }),
  limitHit: f("t5", { values: ["often"] }),
  taskKinds: f("t6", { values: ["code", "write", "summarize"] }),
  mainTask: f("t7", { values: ["code"] }),
  taskSize: f("t8", { values: ["long"] }),
  wishes: f("t9", { values: ["search", "automate", "other"], labels: ["사내 자료 찾기", "반복 업무", "특허 검색"], others: ["특허 검색"] }),
  pain: f("t10", { labels: ["회사 자료를 모른다"] }),
}

test("강도 등급 — 주당 시간 2 · 10 이 경계, 0일은 없음, 시간을 모르면 알 수 없음", () => {
  assert.equal(intensityOf(0, null), "none")
  assert.equal(intensityOf(3, 0), "light", "쓰는 날이 있으면 시간이 0 이어도 없음이 아니다")
  assert.equal(intensityOf(2, 1.9), "light")
  assert.equal(intensityOf(2, 2), "medium")
  assert.equal(intensityOf(5, 9.9), "medium")
  assert.equal(intensityOf(5, 10), "heavy")
  assert.equal(intensityOf(3, null), "unknown")
  assert.equal(intensityOf(null, null), "unknown")
})

test("헤비 사용자 — 주 15시간, 월 1.2억 × 긴 작업 1.5 = 1.8억, API 환산 두 가지", () => {
  const m = computeMetrics(HEAVY)
  assert.equal(m.intensity, "heavy")
  assert.equal(m.hoursPerWeek, 15)
  assert.equal(m.sessionsPerWeek, 90)
  assert.equal(m.derived, "sessions")
  assert.equal(m.monthlyTokens, 180_000_000)
  assert.deepEqual(m.apiKrw, { cache66: 225_000, cache89: 111_600 })
  assert.deepEqual(m.taskShare, { code: 60, write: 20, summarize: 20 })
  assert.equal(m.payer, "personal")
  assert.equal(m.monthlyFeeKrw, 30000)
  assert.deepEqual(m.wishTags, ["search", "automate", "other"])
  assert.deepEqual(m.wishNotes, ["특허 검색"])
})

test("지표마다 근거 응답이 붙는다", () => {
  const m = computeMetrics(HEAVY)
  assert.deepEqual(m.evidence.intensity, ["t1"])
  assert.deepEqual(m.evidence.monthlyTokens, ["t1", "t8"])
  assert.deepEqual(m.evidence.taskShare, ["t6", "t7"])
  assert.deepEqual(m.evidence.subscription, ["t3", "t4", "t2"])
  assert.deepEqual(m.evidence.wishes, ["t9"])
  assert.deepEqual(m.evidence.pains, ["t10"])
})

test("횟수만 답하면 시간을 어림한다(한 번 10분) — 주 4일 × 6번 = 24회 → 4시간 → 보통", () => {
  const m = computeMetrics({ daysPerWeek: f("a", { num: 4 }), sessionsPerDay: f("b", { num: 6 }), taskSize: f("c", { values: ["short"] }) })
  assert.equal(m.sessionsPerWeek, 24)
  assert.equal(m.hoursPerWeek, 4)
  assert.equal(m.derived, "hours")
  assert.equal(m.intensity, "medium")
  assert.equal(m.monthlyTokens, 30_000_000)
})

test("안 쓰는 사람 — 등급 없음 · 토큰 0, 구독 없음은 0원", () => {
  const m = computeMetrics({ daysPerWeek: f("a", { num: 0 }), payer: f("b", { values: ["none"] }) })
  assert.equal(m.intensity, "none")
  assert.equal(m.monthlyTokens, 0)
  assert.deepEqual(m.apiKrw, { cache66: 0, cache89: 0 })
  assert.equal(m.monthlyFeeKrw, 0)
  assert.match(summaryText(m), /쓰지 않습니다/)
})

test("모른다고 답한 사용량은 지어내지 않는다 — 등급 알 수 없음 · 토큰 null", () => {
  const m = computeMetrics({ daysPerWeek: f("a", { unknown: true }), hoursPerDay: f("b", { num: 2 }), payer: f("c", { unknown: true }) })
  assert.equal(m.intensity, "unknown")
  assert.equal(m.monthlyTokens, null)
  assert.equal(m.apiKrw, null)
  assert.equal(m.payer, null)
  assert.equal(m.monthlyFeeKrw, null)
  const half = computeMetrics({ daysPerWeek: f("a", { num: 3 }), hoursPerDay: f("b", { unknown: true }) })
  assert.equal(half.intensity, "unknown")
  assert.equal(half.daysPerWeek, 3)
})

test("작업 비중 — 합은 늘 100, 가장 많이 하는 작업이 3배, 모르는 종류는 버린다", () => {
  assert.deepEqual(taskShares(["write"], undefined), { write: 100 })
  assert.deepEqual(taskShares(["write", "code"], undefined), { write: 50, code: 50 })
  assert.deepEqual(taskShares(["write", "code", "data"], "data"), { write: 20, code: 20, data: 60 })
  const three = taskShares(["write", "code", "data"], undefined)
  assert.equal(Object.values(three).reduce((a, b) => a + b, 0), 100)
  assert.deepEqual(taskShares(["write", "nope"], "nope"), { write: 100 })
  assert.deepEqual(taskShares([], "write"), {})
})

// ─── 회사 전체 — 합계만 ─────────────────────────────────────────────

const row = (userId: string, facts: Facts, status = "SUBMITTED", at = 1) => ({ userId, status, createdAt: new Date(at * 1000), facts })
const LIGHT: Facts = { daysPerWeek: f("a", { num: 1 }), hoursPerDay: f("b", { num: 1 }), payer: f("c", { values: ["company"] }), monthlyFeeKrw: f("d", { num: 44000 }), taskKinds: f("e", { values: ["write"] }), wishes: f("g", { values: ["search"] }), pain: f("h", { labels: ["회사 자료를 모른다", "혼자 쓴 말"] }) }
const MEDIUM: Facts = { daysPerWeek: f("a", { num: 4 }), hoursPerDay: f("b", { num: 1 }), payer: f("c", { values: ["none"] }), recentTask: f("r", { values: ["write"] }), pain: f("h", { labels: ["회사 자료를 모른다"] }) }

test("회사 전체 — 응답 3명 미만이면 합계도 숨긴다(수만 보인다)", () => {
  const s = companySummary(["u1", "u2", "u3", "u4"], [row("u1", HEAVY), row("u2", LIGHT), row("u3", {}, "IN_PROGRESS")])
  assert.deepEqual(s, { headcount: 4, respondents: 2, inProgress: 1, notStarted: 1, totals: null })
  assert.equal(MIN_RESPONSES, 3)
})

test("회사 전체 — 합계 · 평균 일수 · 강도 분포 · 유료 · 개인결제 · 토큰 범위 · 빈도, 이름 · 원문 · 사람별 값은 없다", () => {
  const s = companySummary(["u1", "u2", "u3", "u4", "u5"], [
    row("u1", HEAVY), row("u2", LIGHT), row("u3", MEDIUM),
    row("u4", {}, "CONFIRM"),
    // 퇴사자의 설문은 세지 않는다
    row("gone", HEAVY),
  ])
  assert.equal(s.respondents, 3)
  assert.equal(s.inProgress, 1)
  assert.equal(s.notStarted, 1)
  const t = s.totals!
  assert.equal(t.avgDays, 3.3)
  assert.deepEqual(t.grades, { none: 0, light: 1, medium: 1, heavy: 1, unknown: 0 })
  assert.equal(t.paid, 2)
  assert.equal(t.personalPay, 1)
  assert.equal(t.subscriptionKrw, 74000)
  assert.equal(t.needsCheck, 0)
  assert.equal(t.counted, 3)
  // 1.8억 · 2,200만 · 6,000만(가장 최근 일만 있고 시간은 모름 → 보정 없음) — 평균 × 5명, 범위는 표본 오차
  assert.equal(t.tokens!.respondents, 262_000_000)
  assert.equal(t.tokens!.projected, 436_666_667)
  assert.ok(t.tokens!.low < t.tokens!.projected && t.tokens!.high > t.tokens!.projected)
  assert.deepEqual(t.wishRanking, [{ tag: "search", count: 2 }, { tag: "automate", count: 1 }, { tag: "other", count: 1 }])
  // 두 명 이상 같은 말만 이름이 보이고, 한 명만 쓴 말은 수만 센다
  assert.deepEqual(t.painRanking, [{ label: "회사 자료를 모른다", count: 3 }])
  assert.equal(t.painOthers, 1)
  assert.deepEqual(t.wishNotes, [])
  assert.equal(t.wishOthers, 1)
  assert.deepEqual(t.recentTasks, [{ label: "메일 초안", count: 1 }])
  // 이름 · 사람 id · 한 명만 쓴 글이 어디에도 없다
  const json = JSON.stringify(s)
  for (const leak of ["u1", "u2", "gone", "혼자 쓴 말", "특허 검색", "turnId", "evidence"]) assert.ok(!json.includes(leak), `${leak} 가 새면 안 된다`)
})

test("회사 전체 — 다시 한 사람은 가장 최근에 제출한 1건, 앞뒤가 안 맞는 응답은 확인 필요로 따로 세고 추정에서 뺀다", () => {
  const odd: Facts = { daysPerWeek: f("a", { num: 0 }), recentTask: f("r", { values: ["write"] }), recentWhen: f("w", { num: 1 }) }
  const s = companySummary(["u1", "u2", "u3", "u4"], [
    row("u1", LIGHT, "SUBMITTED", 1), row("u1", HEAVY, "SUBMITTED", 2), row("u1", MEDIUM, "IN_PROGRESS", 3),
    row("u2", LIGHT), row("u3", odd), row("u4", { daysPerWeek: f("a", { unknown: true }) }),
  ])
  const t = s.totals!
  assert.equal(s.respondents, 4)
  assert.equal(t.needsCheck, 1)
  assert.deepEqual(t.flagCounts, [{ code: "zero-days-recent", count: 1 }])
  assert.equal(t.unknownGrade, 1)
  assert.equal(t.counted, 2)
  // u1 은 헤비(1.8억) — 다시 하는 중인 응답이 아니라 마지막 제출
  assert.equal(t.tokens!.respondents, 180_000_000 + 22_000_000)
})

test("전원 환산 범위 — 다 답했으면 범위가 없고, 한 명이면 평균만", () => {
  assert.deepEqual(projectTotal([10, 20], 2), { respondents: 30, projected: 30, low: 30, high: 30 })
  assert.deepEqual(projectTotal([10], 5), { respondents: 10, projected: 50, low: 50, high: 50 })
  assert.equal(projectTotal([], 5), null)
  const r = projectTotal([10, 20, 30], 10)!
  assert.equal(r.projected, 200)
  // 1.96 × 10 × (10/√3) × √(7/9) ≈ 99.8
  assert.deepEqual([r.low, r.high], [100, 300])
})

// ─── 앞뒤가 안 맞는 답(작업지시자 2026-11-12) ─────────────────────────────────────────────

test("앞뒤 판정 — 무료 · 하루 8시간 이상 · 한도 경험 없음", () => {
  const base: Facts = { daysPerWeek: f("d", { num: 5 }), hoursPerDay: f("h", { num: 8 }), payer: f("p", { values: ["none"] }), limitHit: f("l", { values: ["never"] }) }
  assert.deepEqual(computeMetrics(base).flags, [{ code: "free-heavy-no-limit", turnIds: ["p", "h", "l"] }])
  assert.deepEqual(computeMetrics({ ...base, hoursPerDay: f("h", { num: 7.5 }) }).flags, [])
  assert.deepEqual(computeMetrics({ ...base, limitHit: f("l", { values: ["sometimes"] }) }).flags, [])
  assert.deepEqual(computeMetrics({ ...base, payer: f("p", { values: ["company"] }) }).flags, [])
  // 횟수만 답했으면 어림한 하루 시간(50번 × 10분 ≈ 8.3시간)으로 본다
  const noHours: Facts = { ...base }
  delete noHours.hoursPerDay
  assert.equal(computeMetrics({ ...noHours, sessionsPerDay: f("s", { num: 50, over: true }) }).flags![0].code, "free-heavy-no-limit")
})

test("앞뒤 판정 — 주 1일 · 월 구독료 20만 이상", () => {
  const base: Facts = { daysPerWeek: f("d", { num: 1 }), payer: f("p", { values: ["personal"] }), monthlyFeeKrw: f("m", { num: 300000 }) }
  assert.deepEqual(computeMetrics(base).flags, [{ code: "one-day-big-fee", turnIds: ["d", "m"] }])
  assert.deepEqual(computeMetrics({ ...base, monthlyFeeKrw: f("m", { num: 150000 }) }).flags, [])
  assert.deepEqual(computeMetrics({ ...base, daysPerWeek: f("d", { num: 2 }) }).flags, [])
})

test("앞뒤 판정 — 작업은 짧은 질문뿐인데 헤비", () => {
  const base: Facts = { daysPerWeek: f("d", { num: 5 }), hoursPerDay: f("h", { num: 3 }), taskKinds: f("k", { values: ["short_qa"] }) }
  assert.equal(computeMetrics(base).intensity, "heavy")
  assert.deepEqual(computeMetrics(base).flags, [{ code: "short-only-heavy", turnIds: ["k", "d", "h"] }])
  assert.deepEqual(computeMetrics({ ...base, taskKinds: f("k", { values: ["short_qa", "code"] }) }).flags, [])
  assert.deepEqual(computeMetrics({ ...base, hoursPerDay: f("h", { num: 1 }) }).flags, [])
})

test("앞뒤 판정 — 지난주 0일인데 가장 최근 일이 지난주", () => {
  const base: Facts = { daysPerWeek: f("d", { num: 0 }), recentTask: f("r", { values: ["write"] }), recentWhen: f("w", { num: 1 }) }
  assert.deepEqual(computeMetrics(base).flags, [{ code: "zero-days-recent", turnIds: ["d", "w"] }])
  // 이번 주 · 그보다 전이면 맞다
  assert.deepEqual(computeMetrics({ ...base, recentWhen: f("w", { num: 0 }) }).flags, [])
  assert.deepEqual(computeMetrics({ ...base, recentWhen: f("w", { num: 2, over: true }) }).flags, [])
  // 모르면 판정하지 않는다
  assert.deepEqual(computeMetrics({ ...base, daysPerWeek: f("d", { unknown: true }) }).flags, [])
  assert.deepEqual(computeMetrics(HEAVY).flags, [])
})

test("작업 크기 — 가장 최근 일에 주고받은 시간이 「보통 크기」 보다 먼저, 근거도 그 답", () => {
  const withRecent = computeMetrics({ ...HEAVY, recentTask: f("r", { values: ["write"] }), recentTime: f("rt", { num: 5 }) })
  // 헤비 1.2억 × 짧음 0.5 — 보통 크기 답(긴 작업)은 쓰지 않는다
  assert.equal(withRecent.monthlyTokens, 60_000_000)
  assert.equal(withRecent.size, "short")
  assert.equal(withRecent.sizeFrom, "recent")
  assert.deepEqual(withRecent.evidence.monthlyTokens, ["t1", "rt"])
  assert.deepEqual(withRecent.evidence.recent, ["r", "rt"])
  assert.deepEqual([sizeOfMinutes(5), sizeOfMinutes(15), sizeOfMinutes(45), sizeOfMinutes(90)], ["short", "medium", "long", "long"])
  // 주고받은 시간을 모르면 보통 크기
  const unknown = computeMetrics({ ...HEAVY, recentTime: f("rt", { unknown: true }) })
  assert.equal(unknown.sizeFrom, "taskSize")
  assert.equal(unknown.monthlyTokens, 180_000_000)
  assert.deepEqual(unknown.evidence.monthlyTokens, ["t1", "t8"])
})

test("요약 글 — 답한 것만 문장이 된다", () => {
  const s = summaryText(computeMetrics(HEAVY))
  assert.match(s, /주 5일 · 주당 약 15시간 씁니다\(헤비\)/)
  assert.match(s, /개인 부담 · 월 30,000원쯤/)
  assert.match(s, /코딩 · 자동화 60%/)
  assert.match(s, /옴니스에 바라는 것: 사내 자료 찾기, 반복 업무 자동화, 특허 검색/)
  // 아쉬운 점은 옴니스가 아니라 범용 AI 에 대한 것으로 적는다
  assert.match(s, /범용 AI 에서 아쉬운 점: 회사 자료를 모른다/)
  assert.ok(!/(?<!범용 AI 에서 )아쉬운 점:/.test(s))
  assert.equal(summaryText(computeMetrics({})), "답한 내용이 거의 없습니다.")
})

test("토큰 표기", () => {
  assert.equal(tokensLabel(22_000_000), "2,200만")
  assert.equal(tokensLabel(120_000_000), "1.2억")
  assert.equal(tokensLabel(0), "0")
})

test("응답 대기 표 — 모델이 만든 질문만, 첫 질문과 그 뒤를 가른다", () => {
  const turn = (source: "model" | "fallback", first: number | null, total: number, client?: [number, number]) => ({ source, ms: { first, total }, ...(client ? { clientMs: { first: client[0], ready: client[1] } } : {}) })
  const rows = latencyTable([
    [turn("model", 800, 2000, [900, 2100]), turn("model", 600, 1500, [700, 1600]), turn("fallback", 5, 5, [40, 40])],
    [turn("model", 1200, 3000), turn("model", 1000, 2500, [1100, 2600])],
    [turn("fallback", 3, 3)],
    [],
  ])
  const by = Object.fromEntries(rows.map((r) => [r.label, r]))
  assert.deepEqual(by["첫 질문 — 첫 글자(서버)"], { label: "첫 질문 — 첫 글자(서버)", count: 2, p50: 1000, p90: 1160 })
  assert.equal(by["첫 질문 — 글자가 보이기까지(화면)"].count, 1)
  assert.deepEqual([by["다음 질문 — 전체(서버)"].count, by["다음 질문 — 전체(서버)"].p50], [2, 2000])
  assert.deepEqual(latencyTable([])[0], { label: "첫 질문 — 글자가 보이기까지(화면)", count: 0, p50: null, p90: null })
})

test("주 7일 — 일주일 내내 쓰는 사람: 7일 × 2시간 = 14시간 → 헤비", () => {
  const m = computeMetrics({ daysPerWeek: f("a", { num: 7 }), hoursPerDay: f("b", { num: 2 }) })
  assert.equal(m.daysPerWeek, 7)
  assert.equal(m.hoursPerWeek, 14)
  assert.equal(m.intensity, "heavy")
  assert.deepEqual(m.atLeast, {})
  assert.match(summaryText(m), /주 7일 · 주당 약 14시간 씁니다\(헤비\)/)
  // 주 5일 × 1.5시간 = 7.5 → 보통, 주 7일 × 1.5시간 = 10.5 → 헤비 — 주말까지 쓰면 등급이 달라진다
  assert.equal(computeMetrics({ daysPerWeek: f("a", { num: 5 }), hoursPerDay: f("b", { num: 1.5 }) }).intensity, "medium")
  assert.equal(computeMetrics({ daysPerWeek: f("a", { num: 7 }), hoursPerDay: f("b", { num: 1.5 }) }).intensity, "heavy")
})

test("「그 이상」 끝값은 하한으로 세고 「이상」 을 붙인다 — 하루 10시간 이상 · 50번 넘게 · 40만원 넘게", () => {
  const hours = computeMetrics({ daysPerWeek: f("a", { num: 7 }), hoursPerDay: f("b", { num: 10, over: true }), payer: f("c", { values: ["personal"] }), monthlyFeeKrw: f("d", { num: 400000, over: true }) })
  assert.equal(hours.hoursPerWeek, 70)
  assert.deepEqual(hours.atLeast, { amount: true, fee: true })
  assert.equal(hours.monthlyFeeKrw, 400000)
  assert.match(summaryText(hours), /주당 약 70시간 이상/)
  assert.match(summaryText(hours), /월 400,000원 이상/)
  const sessions = computeMetrics({ daysPerWeek: f("a", { num: 5 }), sessionsPerDay: f("b", { num: 50, over: true }) })
  assert.equal(sessions.sessionsPerWeek, 250)
  assert.equal(sessions.atLeast.amount, true)
  // 구간으로 받은 금액은 「쯤」 — 대표값이다
  const fee = computeMetrics({ payer: f("c", { values: ["company"] }), monthlyFeeKrw: f("d", { num: 30000 }) })
  assert.deepEqual(fee.atLeast, {})
  assert.match(summaryText(fee), /월 30,000원쯤/)
  // 안 쓰는 사람 · 유료가 아닌 사람에게는 붙지 않는다
  assert.deepEqual(computeMetrics({ daysPerWeek: f("a", { num: 0 }), hoursPerDay: f("b", { num: 10, over: true }), payer: f("c", { values: ["none"] }), monthlyFeeKrw: f("d", { num: 400000, over: true }) }).atLeast, {})
})

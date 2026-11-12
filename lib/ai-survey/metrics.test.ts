import { test } from "node:test"
import assert from "node:assert/strict"
import { companyEstimate, computeMetrics, intensityOf, latencyTable, summaryText, taskShares, tokensLabel, type Metrics } from "./metrics"
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

const person = (over: Partial<Metrics>): Metrics => ({ ...computeMetrics(HEAVY), ...over })

test("회사 전체 — 응답자 합산 · 전원 환산 · 구독료 · 미응답자 · 순위", () => {
  const light = computeMetrics({ daysPerWeek: f("a", { num: 1 }), hoursPerDay: f("b", { num: 1 }), payer: f("c", { values: ["company"] }), monthlyFeeKrw: f("d", { num: 44000 }), taskKinds: f("e", { values: ["write"] }), wishes: f("g", { values: ["search"] }) })
  const e = companyEstimate({
    members: [{ id: "u1", name: "가" }, { id: "u2", name: "나" }, { id: "u3", name: "다" }, { id: "u4", name: "라" }],
    surveys: [
      { userId: "u1", status: "SUBMITTED", metrics: person({}) },
      { userId: "u2", status: "SUBMITTED", metrics: light },
      { userId: "u3", status: "IN_PROGRESS", metrics: null },
      // 퇴사자의 설문은 세지 않는다
      { userId: "gone", status: "SUBMITTED", metrics: person({}) },
    ],
  })
  assert.equal(e.headcount, 4)
  assert.equal(e.respondents, 2)
  assert.deepEqual(e.inProgress, ["다"])
  assert.deepEqual(e.notStarted, ["라"])
  assert.equal(e.monthlyTokens, 180_000_000 + 22_000_000)
  assert.deepEqual(e.apiKrw, { cache66: 252_500, cache89: 125_240 })
  assert.equal(e.projected?.monthlyTokens, 404_000_000)
  assert.deepEqual(e.subscriptionKrw, { company: 44000, personal: 30000, both: 0, total: 74000 })
  assert.deepEqual(e.grades, { none: 0, light: 1, medium: 0, heavy: 1, unknown: 0 })
  assert.deepEqual(e.taskShare, [{ kind: "write", pct: 60 }, { kind: "code", pct: 30 }, { kind: "summarize", pct: 10 }])
  assert.deepEqual(e.wishRanking, [{ tag: "search", count: 2 }, { tag: "automate", count: 1 }, { tag: "other", count: 1 }])
  assert.deepEqual(e.wishNotes, ["특허 검색"])
})

test("회사 전체 — 제출 전(확인 대기)은 응답으로 세지 않고, 사용량을 모르는 응답은 합산 · 평균에서 뺀다", () => {
  const e = companyEstimate({
    members: [{ id: "u1", name: "가" }, { id: "u2", name: "나" }, { id: "u3", name: "다" }],
    surveys: [
      { userId: "u1", status: "CONFIRM", metrics: person({}) },
      { userId: "u2", status: "SUBMITTED", metrics: person({ intensity: "unknown", monthlyTokens: null, apiKrw: null }) },
      { userId: "u3", status: "SUBMITTED", metrics: person({}) },
    ],
  })
  assert.equal(e.respondents, 2)
  assert.deepEqual(e.inProgress, ["가"])
  assert.equal(e.unknownGrade, 1)
  assert.equal(e.monthlyTokens, 180_000_000)
  assert.equal(e.projected?.monthlyTokens, 540_000_000)
  const none = companyEstimate({ members: [{ id: "u1", name: "가" }], surveys: [] })
  assert.equal(none.projected, null)
  assert.equal(none.monthlyTokens, 0)
  assert.deepEqual(none.notStarted, ["가"])
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

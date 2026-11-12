import { test } from "node:test"
import assert from "node:assert/strict"
import {
  MAX_FREE_TURNS, SLOTS, SLOT_NAMES, answerText, applyAnswer, coverage, editTurn, factsOf, fallbackAsk, fieldMode, freeTurns, guessSay, isComplete, missingSlots,
  lastWeekLabel, lastWeekRange, normalizeAsk, notApplicable, pendingNeeded, pruneFacts, resolveSay, snapNum, turnDead, understoodText, validateAnswer, withLastWeek,
  type AnswerValues, type Ask, type Facts, type Field, type Purpose, type Turn,
} from "./rules"
import { AskOutputSchema, SAY_SYSTEM, SURVEY_SYSTEM, SayOutputSchema, sayPrompt, surveyPrompt, transcript } from "./prompt"

const t = (turnId = "t") => ({ turnId })
/** 2026-11-12(목) 10:00 KST — 지난주는 11월 2일(월)~8일(일) */
const NOW = new Date("2026-11-12T01:00:00Z")
const turn = (id: string, ask: Ask, answer?: AnswerValues, rest: Partial<Turn> = {}): Turn => ({ id, ask, ...(answer ? { answer, answeredAt: "x" } : {}), askedAt: "", source: "fallback", ms: { first: 1, total: 1 }, ...rest })

/** 준비된 질문으로 끝까지 답한 설문 — 칸마다 질문 하나 */
function fullSurvey(pick: (f: Field) => AnswerValues[string] = (f) => (f.kind === "slider" ? { num: f.slot === "daysPerWeek" ? 4 : 2 } : { choice: f.kind === "multi" ? [f.options![0].id, f.options![1].id] : [f.options![1].id] })): Turn[] {
  const turns: Turn[] = []
  for (let i = 0; i < 30; i++) {
    const ask = fallbackAsk(factsOf(turns))
    if (!ask) break
    const f = ask.fields[0]
    turns.push(turn(`t-${f.slot}`, ask, { [f.id]: pick(f) }))
  }
  return turns
}

test("칸 비중 — 목적마다 합이 100 (시간 · 횟수는 하나로 센다)", () => {
  const sum: Record<Purpose, number> = { usage: 0, tasks: 0, wishes: 0 }
  for (const s of SLOT_NAMES) {
    const d = SLOTS[s]
    if (d.purpose && s !== "sessionsPerDay") sum[d.purpose] += d.weight
  }
  assert.deepEqual(sum, { usage: 100, tasks: 100, wishes: 100 })
})

test("범위 — 주 사용 일수는 0~7(주말 포함), 하루 시간은 0~10 에 끝이 「그 이상」, 횟수 · 금액은 구간에 「그 이상」 끝값", () => {
  const days = fallbackAsk({})!.fields[0]
  assert.deepEqual([days.kind, days.min, days.max, days.step, days.unit, days.overLabel], ["slider", 0, 7, 1, "일", undefined])
  const hours = fallbackAsk({ daysPerWeek: { ...t(), num: 7 } })!.fields[0]
  assert.deepEqual([hours.slot, hours.kind, hours.min, hours.max, hours.step, hours.overLabel], ["hoursPerDay", "slider", 0, 10, 0.5, "10시간 이상"])
  for (const slot of ["sessionsPerDay", "monthlyFeeKrw"] as const) {
    const shape = SLOTS[slot].shape
    assert.equal(shape.input.kind, "bucket")
    const b: readonly { label: string; num: number; upTo?: number; over?: true }[] = shape.input.buckets
    assert.equal(b.at(-1)!.over, true, `${slot} 마지막 구간은 그 이상`)
    assert.equal(b.filter((x) => "over" in x).length, 1)
    // 대표값 · 구간 끝이 오름차순이고, 대표값은 그 구간 안에 있다
    for (let i = 1; i < b.length; i++) assert.ok(b[i].num >= b[i - 1].num && (b[i].upTo === undefined || b[i].upTo! > b[i - 1].upTo!))
    for (const x of b) if ("upTo" in x) assert.ok(x.num <= x.upTo!)
  }
})

test("두 갈래 — 범위 칸은 슬라이더 · 구간 칩 · 척도, 나머지는 말(추천 칩)", () => {
  const kinds = Object.fromEntries(fullSurvey().map((x) => [x.ask.fields[0].slot, `${x.ask.fields[0].kind}:${fieldMode(x.ask.fields[0])}`]))
  assert.deepEqual(kinds, {
    daysPerWeek: "slider:range", hoursPerDay: "slider:range", tools: "multi:chat", payer: "single:chat", monthlyFeeKrw: "bucket:range", limitHit: "single:chat",
    taskKinds: "multi:chat", mainTask: "single:chat", recentTask: "single:chat", recentWhen: "bucket:range", recentTime: "bucket:range", wishes: "multi:chat", pain: "multi:chat",
  })
  assert.equal(fieldMode({ kind: "scale" }), "range")
  assert.equal(fieldMode({ kind: "text" }), "chat")
})

test("처음에는 충족도 0, 물을 수 있는 칸에 앞 칸을 기다리는 칸은 없다", () => {
  assert.deepEqual(coverage({}), { usage: 0, tasks: 0, wishes: 0 })
  const open = missingSlots({})
  assert.ok(open.includes("daysPerWeek") && open.includes("payer") && open.includes("taskKinds"))
  assert.ok(!open.includes("monthlyFeeKrw"), "구독료는 유료 여부를 답한 뒤에")
  assert.ok(!open.includes("mainTask"), "가장 많이 하는 작업은 작업 종류를 답한 뒤에")
  assert.ok(!open.includes("free"))
  assert.equal(isComplete({}), false)
})

test("지난주 0일 → 사용량 · 작업은 더 묻지 않고 가장 최근 일(과 그 때) · 바라는 것만 남는다", () => {
  const facts: Facts = { daysPerWeek: { ...t(), num: 0 } }
  assert.deepEqual(missingSlots(facts), ["recentTask", "wishes", "pain"])
  assert.deepEqual(coverage(facts), { usage: 100, tasks: 85, wishes: 0 })
  // 가장 최근 일을 답하면 그 일이 언제였는지는 묻고, 주고받은 시간 · 보통 크기는 묻지 않는다
  assert.deepEqual(missingSlots({ ...facts, recentTask: { ...t(), values: ["write"] } }), ["recentWhen", "wishes", "pain"])
  assert.equal(isComplete({ ...facts, recentTask: { ...t(), unknown: true }, wishes: { ...t(), unknown: true }, pain: { ...t(), unknown: true } }), true)
})

test("「잘 모르겠음」 도 채운 것으로 센다 — 같은 질문을 되풀이하지 않는다", () => {
  const facts: Facts = { daysPerWeek: { ...t(), unknown: true } }
  assert.equal(coverage(facts).usage, 30)
  assert.ok(!missingSlots(facts).includes("daysPerWeek"))
  assert.ok(missingSlots(facts).includes("hoursPerDay"), "모른다고 했을 뿐 0 은 아니다")
})

test("시간 · 횟수는 둘 중 하나만, 구독료는 유료일 때만, 가장 많이 하는 작업은 작업이 둘 이상일 때만", () => {
  assert.equal(notApplicable("hoursPerDay", { sessionsPerDay: { ...t(), num: 8 } }), true)
  assert.equal(notApplicable("monthlyFeeKrw", { payer: { ...t(), values: ["none"] } }), true)
  assert.equal(notApplicable("monthlyFeeKrw", { payer: { ...t(), unknown: true } }), true)
  assert.ok(missingSlots({ payer: { ...t(), values: ["personal"] } }).includes("monthlyFeeKrw"))
  assert.equal(notApplicable("mainTask", { taskKinds: { ...t(), values: ["write"] } }), true)
  assert.ok(missingSlots({ taskKinds: { ...t(), values: ["write", "code"] } }).includes("mainTask"))
})

test("준비된 질문 — 남은 칸을 차례로 묻고 끝까지 가면 모두 100", () => {
  const turns = fullSurvey()
  // 가장 최근 일의 주고받은 시간을 답했으니 「보통 크기」 는 묻지 않는다
  assert.deepEqual(turns.map((x) => x.ask.fields[0].slot), ["daysPerWeek", "hoursPerDay", "tools", "payer", "monthlyFeeKrw", "limitHit", "taskKinds", "mainTask", "recentTask", "recentWhen", "recentTime", "wishes", "pain"])
  for (const x of turns) assert.equal(validateAnswer(x.ask, x.answer), null, `${x.ask.fields[0].slot} 응답이 폼에 맞아야 한다`)
  const facts = factsOf(turns)
  assert.deepEqual(coverage(facts), { usage: 100, tasks: 100, wishes: 100 })
  assert.equal(isComplete(facts), true)
  assert.equal(fallbackAsk(facts), null)
})

test("모델 질문 → 폼: 범위 · 구간은 코드가 정한다 — 모델이 낸 범위 · 종류는 쓰이지 않는다", () => {
  const ask = normalizeAsk({
    question: "  회사 일에  AI 를 얼마나 쓰세요? ",
    fields: [
      { slot: "daysPerWeek", kind: "single", label: "쓰는 날", min: 0, max: 5, step: 3, unit: "개월", options: [{ label: "주 5일", value: null }] },
      { slot: "hoursPerDay", kind: "text", label: "하루" },
    ],
  }, {}, 0, NOW)
  // 사용량 칸은 지난주로 묻는다 — 모델이 날짜를 빠뜨리면 코드가 붙인다
  assert.equal(ask?.question, "회사 일에 AI 를 얼마나 쓰세요? (지난주 11월 2일(월)~8일(일) 기준)")
  assert.deepEqual(ask?.fields.map((f) => [f.id, f.slot, f.kind, f.min, f.max, f.step, f.unit, f.options]), [
    ["f1", "daysPerWeek", "slider", 0, 7, 1, "일", undefined],
    ["f2", "hoursPerDay", "slider", 0, 10, 0.5, "시간", undefined],
  ])
  const fee = normalizeAsk({ question: "얼마 내세요?", fields: [{ slot: "monthlyFeeKrw", kind: "number", options: [{ label: "100만원", value: "1000000" }] }] }, { payer: { ...t(), values: ["company"] } })
  assert.equal(fee?.fields[0].kind, "bucket")
  assert.deepEqual(fee?.fields[0].options?.map((o) => o.num), [15000, 30000, 60000, 150000, 300000, 400000])
  assert.equal(fee?.fields[0].options?.at(-1)?.over, true)
})

test("모델 질문 → 폼: 값이 틀린 보기는 버리고, 모자라면 준비된 보기로. 「기타」 칩은 두지 않는다(말로 받는다)", () => {
  const some = normalizeAsk({ question: "유료로 쓰세요?", fields: [{ slot: "payer", kind: "single", options: [{ label: "안 써요", value: "none" }, { label: "회사 카드", value: "company" }, { label: "이상한 값", value: "boss" }, { label: "또 회사", value: "company" }] }] }, {})
  assert.deepEqual(some?.fields[0].options?.map((o) => [o.label, o.value]), [["안 써요", "none"], ["회사 카드", "company"]])
  const none = normalizeAsk({ question: "유료로 쓰세요?", fields: [{ slot: "payer", kind: "multi", options: [{ label: "?", value: "x" }] }] }, {})
  assert.deepEqual(none?.fields[0].options?.map((o) => o.value), ["none", "company", "personal", "both"])
  const tasks = normalizeAsk({ question: "어떤 일에 쓰세요?", fields: [{ slot: "taskKinds", kind: "multi", options: [{ label: "메일 초안", value: "write" }, { label: "회의록 요약", value: "summarize" }, { label: "실험 설계", value: "lab" }, { label: "기타", value: "other" }] }] }, {})
  assert.deepEqual(tasks!.fields[0].options?.map((o) => [o.label, o.value]), [["메일 초안", "write"], ["회의록 요약", "summarize"], ["실험 설계", "other"]])
  const main = normalizeAsk({ question: "가장 많이 하는 일은?", fields: [{ slot: "mainTask", kind: "single", options: [{ label: "보고서", value: "write" }, { label: "번역", value: "translate" }, { label: "스크립트", value: "code" }] }] }, { taskKinds: { ...t(), values: ["write", "code"] } })
  assert.deepEqual(main?.fields[0].options?.map((o) => o.value), ["write", "code"], "앞에서 고른 작업 안에서만")
})

test("한 질문은 한 갈래 — 범위 칸끼리만 묶고(3개까지), 말로 답하는 칸은 하나만", () => {
  const range = normalizeAsk({ question: "q", fields: [{ slot: "daysPerWeek" }, { slot: "hoursPerDay" }, { slot: "sessionsPerDay" }, { slot: "tools" }] }, {})
  assert.deepEqual(range?.fields.map((f) => f.slot), ["daysPerWeek", "hoursPerDay"], "시간 · 횟수를 함께 묻지 않고, 말로 답하는 칸을 섞지 않는다")
  const chat = normalizeAsk({ question: "q", fields: [{ slot: "tools" }, { slot: "payer" }, { slot: "daysPerWeek" }] }, {})
  assert.deepEqual(chat?.fields.map((f) => f.slot), ["tools"])
  const scale = normalizeAsk({ question: "q", fields: [{ slot: "daysPerWeek" }, { slot: "free", kind: "scale", options: [{ label: "불만", value: null }, { label: "만족", value: null }] }] }, {})
  assert.deepEqual(scale?.fields.map((f) => [f.slot, f.kind]), [["daysPerWeek", "slider"], ["free", "scale"]])
  assert.deepEqual([scale?.fields[1].minLabel, scale?.fields[1].maxLabel], ["불만", "만족"])
})

test("거부 — 이미 답한 칸 · 아직 못 묻는 칸 · 모르는 칸 · 빈 질문이면 폼을 만들지 않는다", () => {
  const facts: Facts = { daysPerWeek: { ...t(), num: 3 } }
  assert.equal(normalizeAsk({ question: "며칠 쓰세요?", fields: [{ slot: "daysPerWeek", kind: "slider" }] }, facts), null, "이미 답한 칸")
  assert.equal(normalizeAsk({ question: "얼마 내세요?", fields: [{ slot: "monthlyFeeKrw", kind: "bucket" }] }, facts), null, "유료 여부를 모르는데 금액부터")
  assert.equal(normalizeAsk({ question: "?", fields: [{ slot: "salary", kind: "slider" }] }, facts), null, "없는 칸")
  assert.equal(normalizeAsk({ question: "   ", fields: [{ slot: "tools", kind: "multi" }] }, facts), null, "빈 질문")
  assert.equal(normalizeAsk({ question: "질문", fields: [] }, facts), null)
  assert.equal(normalizeAsk(null, facts), null)
})

test("후속 질문(free) — 3번까지. 숫자를 글로 받지 않고(number → 슬라이더), 범위가 뒤집혔거나 보기가 하나면 버린다", () => {
  const text = normalizeAsk({ question: "왜 그런가요?", fields: [{ slot: "free", kind: "text" }] }, {})
  assert.deepEqual(text?.fields.map((f) => [f.slot, f.kind]), [["free", "text"]])
  assert.equal(normalizeAsk({ question: "왜 그런가요?", fields: [{ slot: "free", kind: "text" }] }, {}, MAX_FREE_TURNS), null)
  assert.equal(freeTurns([{ ask: text! }, { ask: fallbackAsk({})! }]), 1)
  assert.equal(normalizeAsk({ question: "q", fields: [{ slot: "free", kind: "number", min: 0, max: 20, unit: "명" }] }, {})?.fields[0].kind, "slider")
  assert.equal(normalizeAsk({ question: "q", fields: [{ slot: "free", kind: "slider", min: 10, max: 2 }] }, {}), null)
  assert.equal(normalizeAsk({ question: "q", fields: [{ slot: "free", kind: "single", options: [{ label: "하나", value: null }] }] }, {}), null)
  assert.equal(normalizeAsk({ question: "q", fields: [{ slot: "free", kind: "dropdown" }] }, {}), null)
})

const RANGE: Ask = {
  question: "q",
  fields: [
    { id: "f1", slot: "daysPerWeek", kind: "slider", min: 0, max: 7, step: 1, unit: "일" },
    { id: "f2", slot: "hoursPerDay", kind: "slider", min: 0, max: 10, step: 0.5, unit: "시간", overLabel: "10시간 이상" },
  ],
}
const FEE = fallbackAsk({ daysPerWeek: { ...t(), num: 3 }, hoursPerDay: { ...t(), num: 1 }, tools: { ...t(), labels: ["x"] }, payer: { ...t(), values: ["company"] } })!
const WISH: Ask = { question: "q", fields: [{ id: "f1", slot: "wishes", kind: "multi", options: [{ id: "o1", label: "메일 초안", value: "write" }, { id: "o2", label: "실험 설계", value: "other" }] }] }
const PAYER: Ask = { question: "q", fields: [{ id: "f1", slot: "payer", kind: "single", options: [{ id: "o1", label: "없음", value: "none" }, { id: "o2", label: "회사", value: "company" }] }] }

test("응답 검사 — 폼에 맞으면 통과, 「잘 모르겠음」 은 어느 칸이든 통과", () => {
  assert.equal(validateAnswer(RANGE, { f1: { num: 7 }, f2: { num: 2.5 } }), null)
  assert.equal(validateAnswer(RANGE, { f1: { unknown: true }, f2: { unknown: true } }), null)
  assert.equal(validateAnswer(FEE, { f1: { choice: ["o6"] } }), null)
  assert.equal(validateAnswer(WISH, { f1: { choice: ["o1", "o2"] } }), null)
})

test("거부 — 빠진 칸 · 없는 보기 · 하나만 고를 칸에 둘 · 범위 밖 숫자 · 폼에 없는 칸 · 화면이 보낸 「말로 한 답」", () => {
  assert.match(validateAnswer(RANGE, { f1: { num: 3 } })!, /답하지 않은/)
  assert.match(validateAnswer(RANGE, { f1: { num: 8 }, f2: { num: 1 } })!, /범위/, "일주일은 7일까지")
  assert.match(validateAnswer(RANGE, { f1: { num: 3 }, f2: { num: 10.5 } })!, /범위/)
  assert.match(validateAnswer(RANGE, { f1: { num: "3" }, f2: { num: 1 } })!, /범위에서/)
  assert.match(validateAnswer(RANGE, { f1: { num: NaN }, f2: { num: 1 } })!, /범위에서/)
  assert.match(validateAnswer(RANGE, { f1: { num: 3 }, f2: { num: 1 }, f9: { num: 1 } })!, /폼에 없는 칸/)
  assert.match(validateAnswer(PAYER, { f1: { choice: ["o9"] } })!, /없는 보기/)
  assert.match(validateAnswer(PAYER, { f1: { choice: ["o1", "o2"] } })!, /하나만/)
  assert.match(validateAnswer(FEE, { f1: { choice: ["o1", "o2"] } })!, /하나만/)
  assert.match(validateAnswer(FEE, { f1: { num: 30000 } })!, /골라/, "금액을 숫자로 직접 넣을 수 없다")
  assert.match(validateAnswer(WISH, { f1: { choice: [] } })!, /골라/)
  assert.match(validateAnswer(WISH, { f1: { choice: ["o1", "o1"] } })!, /없는 보기/)
  // 말로 한 답은 서버만 만든다 — 화면이 값까지 정해 보내면 받지 않는다
  assert.match(validateAnswer(WISH, { f1: { said: "전부", values: ["write"], labels: ["문서"] } })!, /골라/)
  assert.match(validateAnswer({ question: "q", fields: [{ id: "f1", slot: "free", kind: "text" }] }, { f1: { said: "x", labels: ["x"] } })!, /말로 답해/)
  assert.match(validateAnswer(RANGE, null)!, /모양/)
  assert.match(validateAnswer(RANGE, [])!, /모양/)
  const scale: Ask = { question: "q", fields: [{ id: "f1", slot: "free", kind: "scale", min: 1, max: 5 }] }
  assert.equal(validateAnswer(scale, { f1: { num: 4 } }), null)
  assert.match(validateAnswer(scale, { f1: { num: 2.5 } })!, /1~5/)
  assert.match(validateAnswer(scale, { f1: { num: 0 } })!, /범위/)
})

test("응답 → 칸: 값 · 보기 이름 · 근거 턴이 남는다. 「그 이상」 끝값은 하한 + over", () => {
  assert.deepEqual(applyAnswer({}, RANGE, { f1: { num: 7 }, f2: { num: 10 } }, "t1"), { daysPerWeek: { turnId: "t1", num: 7 }, hoursPerDay: { turnId: "t1", num: 10, over: true } })
  assert.deepEqual(applyAnswer({}, RANGE, { f1: { num: 5 }, f2: { num: 9.5 } }, "t1").hoursPerDay, { turnId: "t1", num: 9.5 })
  assert.deepEqual(applyAnswer({}, FEE, { f1: { choice: ["o2"] } }, "t2").monthlyFeeKrw, { turnId: "t2", num: 30000, labels: ["3만원쯤 (20달러 요금제 하나)"] })
  assert.deepEqual(applyAnswer({}, FEE, { f1: { choice: ["o6"] } }, "t2").monthlyFeeKrw, { turnId: "t2", num: 400000, labels: ["40만원 넘게"], over: true })
  assert.deepEqual(applyAnswer({}, PAYER, { f1: { choice: ["o2"] } }, "t3").payer, { turnId: "t3", labels: ["회사"], values: ["company"] })
  assert.deepEqual(applyAnswer({}, WISH, { f1: { choice: ["o1", "o2"] } }, "t4").wishes, { turnId: "t4", labels: ["메일 초안", "실험 설계"], values: ["write", "other"], others: ["실험 설계"] })
  assert.deepEqual(applyAnswer({}, PAYER, { f1: { unknown: true } }, "t5").payer, { turnId: "t5", unknown: true })
})

test("응답을 글로 — 내 말풍선. 끝값은 「10시간 이상」, 말로 한 답은 쓴 글 그대로 + 옮긴 결과", () => {
  assert.equal(answerText(RANGE.fields[0], { num: 7 }), "7일")
  assert.equal(answerText(RANGE.fields[1], { num: 10 }), "10시간 이상")
  assert.equal(answerText(RANGE.fields[1], { num: 2.5 }), "2.5시간")
  assert.equal(answerText(FEE.fields[0], { choice: ["o6"] }), "40만원 넘게")
  assert.equal(answerText(RANGE.fields[0], { unknown: true }), "잘 모르겠음")
  assert.equal(answerText({ id: "f", slot: "free", kind: "scale" }, { num: 4 }), "4 / 5")
  assert.equal(answerText(WISH.fields[0], { said: "메일이랑 특허 검색", values: ["write", "other"], labels: ["문서 · 메일 작성", "특허 검색"], others: ["특허 검색"] }), "메일이랑 특허 검색")
  assert.equal(understoodText({ said: "메일이랑 특허 검색", labels: ["문서 · 메일 작성", "특허 검색"] }), "문서 · 메일 작성, 특허 검색")
  assert.equal(understoodText({ said: "Claude", labels: ["Claude"] }), "", "글 그대로면 되풀이하지 않는다")
  assert.equal(understoodText({ choice: ["o1"] }), "")
  assert.equal(answerText(RANGE.fields[0], undefined), "")
})

// ─── 말로 한 답 ─────────────────────────────────────────────

test("글에서 읽은 숫자를 범위 입력에 맞춘다 — 슬라이더는 눈금, 구간 칩은 그 수가 드는 구간", () => {
  assert.equal(snapNum(RANGE.fields[0], 3), 3)
  assert.equal(snapNum(RANGE.fields[0], 9), 7, "일주일을 넘기면 7")
  assert.equal(snapNum(RANGE.fields[0], -2), 0)
  assert.equal(snapNum(RANGE.fields[1], 2.3), 2.5)
  assert.equal(snapNum(RANGE.fields[1], 14), 10)
  assert.equal(snapNum(RANGE.fields[1], NaN), null)
  const fee = FEE.fields[0]
  assert.deepEqual([10_000, 29_000, 30_000, 58_000, 100_000, 147_000, 294_000, 400_000, 734_000].map((n) => snapNum(fee, n)), [15000, 30000, 30000, 60000, 150000, 150000, 300000, 300000, 400000])
  const sessions: Field = { id: "f", slot: "sessionsPerDay", kind: "bucket", options: SLOTS.sessionsPerDay.shape.input.buckets.map((b, i) => ({ id: `o${i}`, ...b })) }
  assert.deepEqual([1, 5, 6, 12, 30, 31, 50, 51, 300].map((n) => snapNum(sessions, n)), [2, 4, 8, 20, 20, 40, 40, 50, 50])
  assert.equal(snapNum(sessions, -1), null)
})

test("말로 한 답 — 지금 묻는 칸에 옮긴다. 값 목록에 있는 값만 받고, 없는 것은 글로 남긴다", () => {
  const turns = [turn("p", WISH)]
  const r = resolveSay({ target: "wishes", values: ["write", "magic", "other"], labels: ["특허 검색"], num: null, unknown: false }, "메일이랑 특허 검색", turns)
  assert.deepEqual(r, { kind: "set", turnId: "p", answer: { f1: { said: "메일이랑 특허 검색", values: ["write", "other"], labels: ["문서 · 메일 작성", "특허 검색"], others: ["특허 검색"] } } })
  const facts = factsOf([turn("p", WISH, (r as { answer: AnswerValues }).answer)])
  assert.deepEqual(facts.wishes, { turnId: "p", labels: ["문서 · 메일 작성", "특허 검색"], values: ["write", "other"], others: ["특허 검색"] })
  // 하나 고르는 칸 — 폼의 보기 안에서만
  assert.deepEqual(resolveSay({ target: "payer", values: ["company"] }, "회사가 내요", [turn("p", PAYER)]), { kind: "set", turnId: "p", answer: { f1: { said: "회사가 내요", values: ["company"], labels: ["회사가 냄"] } } })
  // 이름 그대로 남기는 칸
  const tools: Ask = { question: "q", fields: [{ id: "f1", slot: "tools", kind: "multi", options: [{ id: "o1", label: "ChatGPT" }] }] }
  assert.deepEqual(resolveSay({ target: "tools", labels: ["Claude", "Perplexity"] }, "클로드랑 퍼플렉시티", [turn("p", tools)]), { kind: "set", turnId: "p", answer: { f1: { said: "클로드랑 퍼플렉시티", labels: ["Claude", "Perplexity"] } } })
  // 모른다
  assert.deepEqual(resolveSay({ target: "payer", unknown: true }, "잘 모르겠어요", [turn("p", PAYER)]), { kind: "set", turnId: "p", answer: { f1: { unknown: true } } })
  // 후속 질문은 글 그대로
  const free: Ask = { question: "q", fields: [{ id: "f1", slot: "free", kind: "text" }] }
  assert.deepEqual(resolveSay({ target: "none" }, "회사 자료를 몰라서요", [turn("p", free)]), { kind: "set", turnId: "p", answer: { f1: { said: "회사 자료를 몰라서요", labels: ["회사 자료를 몰라서요"] } } })
})

test("거부 — 값 목록에 없는 값 · 폼의 보기에 없는 값 · 아직 묻지 않은 칸 · 어느 칸인지 모르는 말", () => {
  assert.deepEqual(resolveSay({ target: "payer", values: ["boss"] }, "사장님이요", [turn("p", PAYER)]), { kind: "unclear", reason: "no-value" })
  // both 는 값 목록에는 있지만 이 폼의 보기에는 없다
  assert.deepEqual(resolveSay({ target: "payer", values: ["both"] }, "둘 다", [turn("p", PAYER)]), { kind: "unclear", reason: "no-value" })
  assert.deepEqual(resolveSay({ target: "wishes", values: [], labels: [] }, "음", [turn("p", WISH)]), { kind: "unclear", reason: "no-value" })
  assert.deepEqual(resolveSay({ target: "taskSize", values: ["long"] }, "긴 작업", [turn("a", PAYER, { f1: { choice: ["o1"] } }), turn("p", WISH)]), { kind: "unclear", reason: "not-asked" })
  // 묻는 질문이 없고(요약 확인 중) 대상도 못 짚었다
  assert.deepEqual(resolveSay({ target: "none" }, "안녕", [turn("a", PAYER, { f1: { choice: ["o1"] } })]), { kind: "unclear", reason: "no-target" })
  assert.deepEqual(resolveSay(null, "안녕", []), { kind: "unclear", reason: "no-target" })
})

test("범위 칸은 글로 확정하지 않는다 — 말로 답하거나 고쳐도 범위 입력을 그 값으로 맞춰 띄울 뿐이다", () => {
  const days: Ask = { question: "q", fields: [RANGE.fields[0]] }
  const turns = [turn("a", days, { f1: { num: 4 } }), turn("b", FEE, { f1: { choice: ["o2"] } }), turn("p", WISH)]
  assert.deepEqual(resolveSay({ target: "daysPerWeek", num: 3 }, "아까 4일 아니고 3일", turns), { kind: "range", turnId: "a", fieldId: "f1", num: 3 })
  assert.deepEqual(resolveSay({ target: "monthlyFeeKrw", num: 147000 }, "구독료 100달러짜리로", turns), { kind: "range", turnId: "b", fieldId: "f1", num: 150000 })
  assert.deepEqual(resolveSay({ target: "daysPerWeek", num: null }, "날짜 다시", turns), { kind: "range", turnId: "a", fieldId: "f1", num: null })
  // 지금 묻는 범위 질문에 숫자를 글로 쳐도 마찬가지
  assert.deepEqual(resolveSay({ target: "daysPerWeek", num: 12 }, "12일", [turn("p", days)]), { kind: "range", turnId: "p", fieldId: "f1", num: 7 })
})

test("말로 고치기 — 이미 답한 말 칸은 그 자리에서 바꾼다. 말풍선을 눌러 고치는 중이면 그 질문만 본다", () => {
  const turns = [turn("a", PAYER, { f1: { choice: ["o1"] } }), turn("p", WISH)]
  assert.deepEqual(resolveSay({ target: "payer", values: ["company"] }, "구독은 회사가 내는 걸로 바꿔줘", turns), { kind: "set", turnId: "a", answer: { f1: { said: "구독은 회사가 내는 걸로 바꿔줘", values: ["company"], labels: ["회사가 냄"] } } })
  // 고치는 중인 질문(only)이 있으면 대상을 못 짚어도 그 질문의 답으로 본다
  assert.deepEqual(resolveSay({ target: "none", values: ["company"] }, "회사", turns, "a"), { kind: "set", turnId: "a", answer: { f1: { said: "회사", values: ["company"], labels: ["회사가 냄"] } } })
  // 같은 칸을 두 번 물었으면 뒤의 것이 지금의 답이다
  const twice = [turn("a", PAYER, { f1: { choice: ["o1"] } }), turn("b", PAYER, { f1: { choice: ["o1"] } })]
  assert.equal((resolveSay({ target: "payer", values: ["company"] }, "회사", twice) as { turnId: string }).turnId, "b")
})

test("모델 없이 글 읽기 — 숫자 + 단위는 그 범위 칸, 그 밖에는 지금 질문의 보기 이름", () => {
  const days: Ask = { question: "q", fields: [RANGE.fields[0]] }
  const hours: Ask = { question: "q", fields: [RANGE.fields[1]] }
  const turns = [turn("a", days, { f1: { num: 4 } }), turn("h", hours, { f1: { num: 2 } }), turn("b", FEE, { f1: { choice: ["o2"] } }), turn("p", WISH)]
  assert.deepEqual(guessSay("아까 4일 아니고 3일", turns), { target: "daysPerWeek", num: 3 })
  assert.deepEqual(guessSay("사실 매일 써요", turns), { target: "daysPerWeek", num: 7 })
  assert.deepEqual(guessSay("하루 5시간으로 고쳐줘", turns), { target: "hoursPerDay", num: 5 })
  assert.deepEqual(guessSay("구독료는 15만원", turns), { target: "monthlyFeeKrw", num: 150000 })
  assert.deepEqual(guessSay("구독료는 29,000원", turns), { target: "monthlyFeeKrw", num: 29000 })
  assert.deepEqual(resolveSay(guessSay("아까 4일 아니고 3일", turns), "아까 4일 아니고 3일", turns), { kind: "range", turnId: "a", fieldId: "f1", num: 3 })
  // 묻지 않은 칸의 단위는 건드리지 않고 지금 질문의 답으로 읽는다
  assert.deepEqual(guessSay("하루 20번", turns), { target: "wishes", values: [], labels: ["하루 20번"] })
  assert.deepEqual(guessSay("메일 초안이요", turns), { target: "wishes", values: ["write"], labels: [] })
  assert.deepEqual(guessSay("번역이랑 요약 · 정리", turns), { target: "wishes", values: ["summarize", "translate"], labels: [] })
  assert.deepEqual(guessSay("글쎄 모르겠네", turns), { target: "wishes", unknown: true })
  assert.deepEqual(guessSay("회사", [turn("p", PAYER)]), { target: "payer", values: ["company"], labels: [] })
  assert.deepEqual(resolveSay(guessSay("사장님", [turn("p", PAYER)]), "사장님", [turn("p", PAYER)]), { kind: "unclear", reason: "no-value" })
})

// ─── 답 고치기 ─────────────────────────────────────────────

test("답 고치기 — 그 자리에서 답만 바꾼다. 대화는 그대로이고 「처음 답」 이 남는다", () => {
  const turns = fullSurvey()
  const days = turns[0]
  const next = editTurn(turns, days.id, { f1: { num: 3 } }, "2026-11-11T00:00:00Z")!
  assert.equal(next.length, turns.length, "대화를 되돌리지 않는다")
  assert.deepEqual(next[0].answer, { f1: { num: 3 } })
  assert.deepEqual(next[0].edited, { from: "4일", at: "2026-11-11T00:00:00Z" })
  assert.deepEqual(next.slice(1), turns.slice(1))
  assert.equal(factsOf(next).daysPerWeek?.num, 3)
  // 한 번 더 고쳐도 처음 답이 남는다. 같은 답을 다시 고르면 고친 것이 아니다
  assert.equal(editTurn(next, days.id, { f1: { num: 5 } }, "later")![0].edited?.from, "4일")
  assert.equal(editTurn(turns, days.id, { f1: { num: 4 } }, "x")![0].edited, undefined)
  // 원래 것은 건드리지 않는다
  assert.deepEqual(turns[0].answer, { f1: { num: 4 } })
})

test("거부 — 없는 질문 · 아직 답하지 않은 질문은 고치지 않는다", () => {
  const pending = turn("p", PAYER)
  assert.equal(editTurn([pending], "p", { f1: { choice: ["o1"] } }, "x"), null)
  assert.equal(editTurn([pending], "없는-id", { f1: { choice: ["o1"] } }, "x"), null)
  assert.equal(editTurn([], "p", {}, "x"), null)
})

test("고친 결과로 필요 없어진 칸은 코드가 지운다 — 유료 → 무료면 월 금액", () => {
  const turns = fullSurvey()
  assert.equal(factsOf(turns).monthlyFeeKrw?.num, 30000)
  const payer = turns.find((x) => x.ask.fields[0].slot === "payer")!
  const none = payer.ask.fields[0].options!.find((o) => o.value === "none")!.id
  const next = editTurn(turns, payer.id, { f1: { choice: [none] } }, "x")!
  const facts = factsOf(next)
  assert.equal(facts.monthlyFeeKrw, undefined)
  assert.equal(isComplete(facts), true, "새로 물을 것은 없다")
  const fee = next.find((x) => x.ask.fields[0].slot === "monthlyFeeKrw")!
  assert.equal(turnDead(fee, facts), true, "금액 답은 흐리게")
  assert.equal(turnDead(payer, facts), false)
  // 다시 유료로 고치면 지워졌던 금액 답이 되살아난다 — 다시 묻지 않는다
  const back = factsOf(editTurn(next, payer.id, { f1: { choice: [payer.ask.fields[0].options!.find((o) => o.value === "personal")!.id] } }, "y")!)
  assert.equal(back.monthlyFeeKrw?.num, 30000)
})

test("고친 결과로 필요 없어진 칸 — 0일이면 사용량 · 작업 전부, 작업이 하나면 가장 많이 하는 작업", () => {
  const turns = fullSurvey()
  const zero = factsOf(editTurn(turns, turns[0].id, { f1: { num: 0 } }, "x")!)
  // 가장 최근 일 · 그 때는 0일이어도 남는다(앞뒤 판정에 쓴다)
  assert.deepEqual(Object.keys(zero).sort(), ["daysPerWeek", "pain", "recentTask", "recentWhen", "wishes"])
  assert.equal(isComplete(zero), true)
  assert.deepEqual(coverage(zero), { usage: 100, tasks: 100, wishes: 100 })

  const kinds = turns.find((x) => x.ask.fields[0].slot === "taskKinds")!
  const one = factsOf(editTurn(turns, kinds.id, { f1: { choice: [kinds.ask.fields[0].options![0].id] } }, "x")!)
  assert.equal(one.mainTask, undefined)
  assert.equal(isComplete(one), true)
})

test("고쳐서 새로 열린 칸은 대화 끝에 이어서 묻는다 — 무료 → 유료면 월 금액, 고른 작업이 바뀌면 가장 많이 하는 작업", () => {
  const free = fullSurvey((f) => (f.slot === "payer" ? { choice: [f.options!.find((o) => o.value === "none")!.id] } : f.kind === "slider" ? { num: 2 } : { choice: f.kind === "multi" ? [f.options![0].id, f.options![1].id] : [f.options![1].id] }))
  assert.ok(!free.some((x) => x.ask.fields[0].slot === "monthlyFeeKrw"), "무료라 금액은 묻지 않았다")
  const payer = free.find((x) => x.ask.fields[0].slot === "payer")!
  const paid = editTurn(free, payer.id, { f1: { choice: [payer.ask.fields[0].options!.find((o) => o.value === "company")!.id] } }, "x")!
  const facts = factsOf(paid)
  assert.equal(isComplete(facts), false)
  assert.deepEqual(missingSlots(facts), ["monthlyFeeKrw"])
  assert.equal(fallbackAsk(facts)!.fields[0].slot, "monthlyFeeKrw")

  // 가장 많이 하는 작업으로 골랐던 것이 고른 작업에서 빠지면 그 답을 지우고 다시 묻는다
  const turns = fullSurvey()
  const kinds = turns.find((x) => x.ask.fields[0].slot === "taskKinds")!
  const main = factsOf(turns).mainTask!.values![0]
  const others = kinds.ask.fields[0].options!.filter((o) => o.value !== main).slice(0, 2).map((o) => o.id)
  const changed = factsOf(editTurn(turns, kinds.id, { f1: { choice: others } }, "x")!)
  assert.equal(changed.mainTask, undefined)
  assert.deepEqual(missingSlots(changed), ["mainTask"])
})

test("근거가 바뀐 후속 질문은 버린다 — 그 답을 보고 물었던 것만", () => {
  const free: Ask = { question: "왜 그런가요?", fields: [{ id: "f1", slot: "free", kind: "text" }] }
  const said = { f1: { said: "한도가 자주 걸려서요", labels: ["한도가 자주 걸려서요"] } }
  const turns = [turn("a", PAYER, { f1: { choice: ["o2"] } }), turn("f", free, said, { basis: "a" }), turn("w", WISH, { f1: { choice: ["o1"] } }, { basis: "f" }), turn("g", free, said, { basis: "w" })]
  const next = editTurn(turns, "a", { f1: { choice: ["o1"] } }, "x")!
  assert.equal(next[1].stale, true)
  assert.equal(next[3].stale, undefined, "다른 답을 보고 물은 후속 질문은 그대로")
  assert.equal(next[2].stale, undefined, "칸이 있는 질문은 버리지 않는다")
  const facts = factsOf(next)
  assert.equal(turnDead(next[1], facts), true)
  assert.equal(turnDead(next[3], facts), false)
  assert.ok(!transcript(next).includes("한도가 자주 걸려서요\n2."), "버린 후속 질문은 모델에게 주지 않는다")
  assert.equal(transcript(next).match(/왜 그런가요/g)?.length, 1)
})

test("묻던 질문이 고친 답 때문에 필요 없어지면 걷는다", () => {
  const paid: Facts = { payer: { ...t(), values: ["company"] } }
  const pending = turn("p", FEE)
  assert.equal(pendingNeeded(pending, pruneFacts(paid)), true)
  assert.equal(pendingNeeded(pending, { payer: { ...t(), values: ["none"] } }), false)
  assert.equal(pendingNeeded(turn("p", WISH), { daysPerWeek: { ...t(), num: 0 } }), true, "바라는 것은 0일이어도 묻는다")
  assert.equal(pendingNeeded(turn("p", RANGE), { daysPerWeek: { ...t(), num: 3 } }), false, "이미 채운 칸이 든 질문")
  const free: Ask = { question: "q", fields: [{ id: "f1", slot: "free", kind: "text" }] }
  assert.equal(pendingNeeded(turn("p", free), {}), true)
  assert.equal(pendingNeeded(turn("p", free, undefined, { stale: true }), {}), false)
})

// ─── 모델 지시 ─────────────────────────────────────────────

test("아쉬운 점은 범용 AI, 바라는 것은 옴니스 — 준비된 질문과 모델 지시가 둘을 가른다", () => {
  const done: Facts = { daysPerWeek: { turnId: "t", num: 0 }, recentTask: { turnId: "t", unknown: true } }
  const wish = fallbackAsk(done)!
  assert.match(wish.question, /옴니스/)
  assert.ok(!wish.question.includes("범용 AI"))
  const pain = fallbackAsk({ ...done, wishes: { turnId: "t", unknown: true } })!
  assert.equal(pain.fields[0].slot, "pain")
  assert.match(pain.question, /범용 AI/)
  assert.ok(!pain.question.includes("옴니스"), "아쉬운 점 질문은 옴니스를 가리키지 않는다")
  assert.ok(SLOTS.pain.shape.defaults.every((d) => !d.includes("옴니스")))
  assert.ok(!SURVEY_SYSTEM.includes("AI(옴니스)가 해 주길 바라는 것과 아쉬운 점"), "둘을 한 줄로 묶지 않는다")
  assert.match(SURVEY_SYSTEM, /바라는 것\(wishes\): 「옴니스」/)
  assert.match(SURVEY_SYSTEM, /아쉬운 점\(pain\): 「범용 AI」\(ChatGPT · Claude · Gemini/)
  assert.match(SURVEY_SYSTEM, /아쉬운 점\(pain\)을 묻는 질문에는 반드시 「범용 AI」 라고 쓴다/)
  assert.match(SURVEY_SYSTEM, /wishes 와 pain 은 한 질문에 묶지 않는다/)
})

test("모델 지시 — 칸 전부 · 두 갈래 · 일주일 7일이 들어 있고, 기록에는 답한 문답만 지금 값으로 실린다", () => {
  for (const s of SLOT_NAMES) assert.ok(SURVEY_SYSTEM.includes(`- ${s}:`), `${s} 안내`)
  assert.match(SURVEY_SYSTEM, /short_qa\(짧은 질문\)/)
  assert.match(SURVEY_SYSTEM, /일주일은 7일이다/)
  assert.match(SURVEY_SYSTEM, /- daysPerWeek: .*0~7일/)
  assert.match(SURVEY_SYSTEM, /말로 답하는 칸은 한 번에 하나만/)
  assert.ok(!/주 5일 중\)/.test(SURVEY_SYSTEM.split("규칙")[0]), "칸 설명에 주 5일이 남아 있지 않다")
  assert.equal(transcript([]), "(아직 없음 — 첫 질문이다)")
  const days: Ask = { question: "며칠 쓰세요?", fields: [RANGE.fields[0]] }
  const turns = editTurn([turn("a", days, { f1: { num: 4 } }), turn("b", PAYER)], "a", { f1: { num: 3 } }, "x")!
  const text = transcript(turns)
  assert.match(text, /1\. 질문: 며칠 쓰세요\?\n {3}답: 3일/)
  assert.ok(!text.includes("4일") && !text.includes("2. 질문"), "고치기 전 답 · 아직 답하지 않은 질문은 싣지 않는다")
  const p = surveyPrompt(turns, factsOf(turns), 0)
  assert.match(p, /남은 칸: hoursPerDay, sessionsPerDay, tools, payer, limitHit, taskKinds, recentTask, wishes, pain/)
  assert.match(p, /free 는 더 쓸 수 없다/)
})

test("글 읽기 지시 — 고치는 말을 가리고, 범위 칸은 숫자만, 값 목록 밖은 지어내지 않게 한다", () => {
  assert.match(SAY_SYSTEM, /아까 4일 아니고 3일/)
  assert.match(SAY_SYSTEM, /지어내지 말고/)
  assert.match(SAY_SYSTEM, /「매일」 은 7일/)
  assert.match(SAY_SYSTEM, /- payer: none\(유료로 쓰지 않음\)/)
  const days: Ask = { question: "며칠 쓰세요?", fields: [RANGE.fields[0]] }
  const turns = [turn("a", days, { f1: { num: 4 } }), turn("p", PAYER)]
  const p = sayPrompt("아까 4일 아니고 3일", turns)
  assert.match(p, /- daysPerWeek\(범위\) — 질문: 며칠 쓰세요\? — 답: 4일/)
  assert.match(p, /지금 묻는 질문: q\n칸: payer\(말\) · 추천 칩: 없음=none \| 회사=company/)
  assert.match(p, /응답자가 쓴 글: "아까 4일 아니고 3일"/)
  assert.match(sayPrompt("회사", turns, "a"), /지금 고치는 질문: 며칠 쓰세요\?/)
  assert.match(sayPrompt("3일로", [turns[0]]), /요약을 확인하는 중/)
})

test("모델 출력 스키마 — 모양이 맞으면 통과, 칸 이름이 틀리면 거부", () => {
  const good = { question: "q", fields: [{ slot: "tools", kind: "multi", label: null, options: [{ label: "ChatGPT", value: null }], min: null, max: null, step: null, unit: null }] }
  assert.equal(AskOutputSchema.safeParse(good).success, true)
  assert.equal(AskOutputSchema.safeParse({ ...good, fields: [{ ...good.fields[0], slot: "salary" }] }).success, false)
  assert.equal(AskOutputSchema.safeParse({ question: "q" }).success, false)
  const say = { target: "daysPerWeek", values: [], labels: [], num: 3, unknown: false }
  assert.equal(SayOutputSchema.safeParse(say).success, true)
  assert.equal(SayOutputSchema.safeParse({ ...say, target: "none" }).success, true)
  assert.equal(SayOutputSchema.safeParse({ ...say, target: "salary" }).success, false)
  assert.equal(SayOutputSchema.safeParse({ target: "tools" }).success, false)
})

// ─── 지난주 · 가장 최근 일(작업지시자 2026-11-12) ─────────────────────────────────────────────

test("지난주 — 묻는 날(서울 기준)의 앞 주 월~일, 달이 바뀌면 두 달을 다 쓴다", () => {
  assert.equal(lastWeekLabel(NOW), "11월 2일(월)~8일(일)")
  // 월요일 0시(서울)는 이미 새 주다 — 일요일 23시(UTC 로는 일요일 14시)와 갈린다
  assert.equal(lastWeekLabel(new Date("2026-11-08T14:59:00Z")), "10월 26일(월)~11월 1일(일)")
  assert.equal(lastWeekLabel(new Date("2026-11-08T15:00:00Z")), "11월 2일(월)~8일(일)")
  const { start, end } = lastWeekRange(NOW)
  assert.deepEqual([start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)], ["2026-11-02", "2026-11-08"])
  // 해가 바뀌는 주
  assert.equal(lastWeekLabel(new Date("2027-01-05T03:00:00Z")), "12월 28일(월)~1월 3일(일)")
})

test("사용 일수 · 시간 · 횟수는 「평소」 가 아니라 지난주 — 준비된 질문은 날짜를 괄호에, 모델 질문은 없으면 붙인다", () => {
  const days = fallbackAsk({}, NOW)!
  assert.equal(days.question, "지난주(11월 2일(월)~8일(일))에 회사 일로 AI 를 쓴 날은 며칠이에요? 주말도 넣어서요.")
  const hours = fallbackAsk({ daysPerWeek: { ...t(), num: 3 } }, NOW)!
  assert.match(hours.question, /^지난주\(11월 2일\(월\)~8일\(일\)\)/)
  for (const q of [days.question, hours.question]) assert.ok(!/평소|보통/.test(q))
  assert.equal(withLastWeek("지난주에 며칠 쓰셨어요?", "11월 2일(월)~8일(일)"), "지난주(11월 2일(월)~8일(일))에 며칠 쓰셨어요?")
  assert.equal(withLastWeek("지난주(11월 2일(월)~8일(일)) 며칠?", "11월 2일(월)~8일(일)"), "지난주(11월 2일(월)~8일(일)) 며칠?")
  // 사용량 칸이 없는 질문은 그대로
  assert.equal(normalizeAsk({ question: "어떤 도구를 쓰세요?", fields: [{ slot: "tools", kind: "multi" }] }, {}, 0, NOW)?.question, "어떤 도구를 쓰세요?")
  // 모델 지시 · 프롬프트에도 지난주
  assert.match(SURVEY_SYSTEM, /「평소」 · 「보통」 이 아니라 「지난주\(월~일\)」 를 묻는다/)
  assert.match(surveyPrompt([], {}, 3, NOW), /^지난주: 11월 2일\(월\)~8일\(일\)/)
})

test("가장 최근 일 — 칩은 메일 초안 · 문서 요약 · 표 정리 · 번역 · 코드 · 기억 안 남 · 기타, 뒤에 언제 · 주고받은 시간", () => {
  const facts: Facts = { daysPerWeek: { ...t(), num: 3 }, hoursPerDay: { ...t(), num: 1 }, tools: { ...t(), labels: ["x"] }, payer: { ...t(), values: ["none"] }, limitHit: { ...t(), values: ["never"] }, taskKinds: { ...t(), values: ["write"] } }
  const ask = fallbackAsk(facts, NOW)!
  assert.equal(ask.fields[0].slot, "recentTask")
  assert.deepEqual(ask.fields[0].options!.map((o) => o.label), ["메일 초안", "문서 요약", "표 정리", "번역", "코드", "기억 안 남", "기타"])
  assert.equal(fieldMode(ask.fields[0]), "chat")
  const when = fallbackAsk({ ...facts, recentTask: { ...t(), values: ["write"] } }, NOW)!
  assert.equal(when.fields[0].slot, "recentWhen")
  // 「지난주」 칩에는 날짜가 붙는다
  assert.deepEqual(when.fields[0].options!.map((o) => o.label), ["이번 주", "지난주(11월 2일(월)~8일(일))", "그보다 전"])
  const time = fallbackAsk({ ...facts, recentTask: { ...t(), values: ["write"] }, recentWhen: { ...t(), num: 0 } }, NOW)!
  assert.equal(time.fields[0].slot, "recentTime")
  assert.deepEqual(time.fields[0].options!.map((o) => o.label), ["5분 이내", "5~30분", "30분~1시간", "1시간 넘게"])
  // 기억이 안 나면 언제 · 주고받은 시간은 묻지 않고 「보통 크기」 로 간다
  const none = { ...facts, recentTask: { ...t(), values: ["none"] } }
  assert.equal(notApplicable("recentWhen", none), true)
  assert.equal(notApplicable("recentTime", none), true)
  assert.equal(fallbackAsk(none, NOW)!.fields[0].slot, "taskSize")
  // 주고받은 시간을 답했으면 「보통 크기」 는 묻지 않는다 · 모르면 묻는다
  assert.equal(notApplicable("taskSize", { recentTime: { ...t(), num: 15 } }), true)
  assert.equal(notApplicable("taskSize", { recentTime: { ...t(), unknown: true } }), false)
  // 가장 최근 일을 고치면 지워진다
  const pruned = pruneFacts({ ...none, recentWhen: { ...t(), num: 1 }, recentTime: { ...t(), num: 5 } })
  assert.equal(pruned.recentWhen, undefined)
  assert.equal(pruned.recentTime, undefined)
})

test("가장 최근 일을 말로 — 보기에 없는 일은 글 그대로 「기타」", () => {
  const ask = fallbackAsk({ daysPerWeek: { ...t(), num: 3 }, hoursPerDay: { ...t(), num: 1 }, tools: { ...t(), labels: ["x"] }, payer: { ...t(), values: ["none"] }, limitHit: { ...t(), values: ["never"] }, taskKinds: { ...t(), values: ["write"] } }, NOW)!
  const turns = [turn("r", ask)]
  const said = resolveSay(guessSay("회의록 정리", turns), "회의록 정리", turns)
  assert.equal(said.kind, "set")
  const facts = factsOf([turn("r", ask, (said as { answer: AnswerValues }).answer)])
  assert.deepEqual(facts.recentTask?.values, ["other"])
  assert.deepEqual(facts.recentTask?.others, ["회의록 정리"])
  // 보기 이름을 말하면 그 값
  const mail = resolveSay(guessSay("문서 요약이요", turns), "문서 요약이요", turns)
  assert.deepEqual(factsOf([turn("r", ask, (mail as { answer: AnswerValues }).answer)]).recentTask?.values, ["summarize"])
})

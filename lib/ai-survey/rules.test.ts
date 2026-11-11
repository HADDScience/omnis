import { test } from "node:test"
import assert from "node:assert/strict"
import {
  MAX_FREE_TURNS, SLOTS, SLOT_NAMES, answerText, applyAnswer, coverage, fallbackAsk, freeTurns, isComplete, missingSlots, normalizeAsk, notApplicable, validateAnswer,
  type Ask, type Facts, type Purpose,
} from "./rules"
import { AskOutputSchema, SURVEY_SYSTEM, surveyPrompt, transcript } from "./prompt"

const t = (turnId = "t") => ({ turnId })

test("칸 비중 — 목적마다 합이 100 (시간 · 횟수는 하나로 센다)", () => {
  const sum: Record<Purpose, number> = { usage: 0, tasks: 0, wishes: 0 }
  for (const s of SLOT_NAMES) {
    const d = SLOTS[s]
    if (d.purpose && s !== "sessionsPerDay") sum[d.purpose] += d.weight
  }
  assert.deepEqual(sum, { usage: 100, tasks: 100, wishes: 100 })
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

test("AI 를 안 쓴다(0일) → 사용량 · 작업은 더 묻지 않고 바라는 것만 남는다", () => {
  const facts: Facts = { daysPerWeek: { ...t(), num: 0 } }
  assert.deepEqual(missingSlots(facts), ["wishes", "pain"])
  assert.deepEqual(coverage(facts), { usage: 100, tasks: 100, wishes: 0 })
  assert.equal(isComplete(facts), false)
  assert.equal(isComplete({ ...facts, wishes: { ...t(), unknown: true }, pain: { ...t(), unknown: true } }), true)
})

test("「잘 모르겠음」 도 채운 것으로 센다 — 같은 질문을 되풀이하지 않는다", () => {
  const facts: Facts = { daysPerWeek: { ...t(), unknown: true } }
  assert.equal(coverage(facts).usage, 30)
  assert.ok(!missingSlots(facts).includes("daysPerWeek"))
  // 모른다고 했을 뿐 0 은 아니다 — 나머지는 계속 묻는다
  assert.ok(missingSlots(facts).includes("hoursPerDay"))
})

test("시간 · 횟수는 둘 중 하나만 — 하나를 답하면 다른 쪽은 닫힌다", () => {
  const facts: Facts = { sessionsPerDay: { ...t(), num: 12 } }
  assert.equal(notApplicable("hoursPerDay", facts), true)
  assert.equal(coverage(facts).usage, 25)
  assert.ok(!missingSlots(facts).includes("hoursPerDay"))
})

test("구독료 — 유료가 아니거나 모르면 묻지 않고, 유료면 열린다", () => {
  assert.equal(notApplicable("monthlyFeeKrw", { payer: { ...t(), values: ["none"] } }), true)
  assert.equal(notApplicable("monthlyFeeKrw", { payer: { ...t(), unknown: true } }), true)
  const paid: Facts = { payer: { ...t(), values: ["personal"] } }
  assert.equal(notApplicable("monthlyFeeKrw", paid), false)
  assert.ok(missingSlots(paid).includes("monthlyFeeKrw"))
})

test("가장 많이 하는 작업 — 작업이 하나뿐이면 묻지 않는다", () => {
  assert.equal(notApplicable("mainTask", { taskKinds: { ...t(), values: ["write"] } }), true)
  assert.ok(missingSlots({ taskKinds: { ...t(), values: ["write", "code"] } }).includes("mainTask"))
})

test("준비된 질문 — 남은 칸을 차례로 묻고 끝까지 가면 모두 100", () => {
  let facts: Facts = {}
  const asked: string[] = []
  for (let i = 0; i < 30; i++) {
    const ask = fallbackAsk(facts)
    if (!ask) break
    const f = ask.fields[0]
    asked.push(f.slot)
    assert.equal(validateAnswer(ask, { [f.id]: { unknown: true } }), null)
    const values = f.kind === "slider" || f.kind === "number" ? { [f.id]: { num: f.slot === "daysPerWeek" ? 4 : f.min! + 1 } } : { [f.id]: { choice: f.kind === "multi" ? [f.options![0].id, f.options![1].id] : [f.options![1].id] } }
    assert.equal(validateAnswer(ask, values), null, `${f.slot} 응답이 폼에 맞아야 한다`)
    facts = applyAnswer(facts, ask, values, `t${i}`)
  }
  assert.deepEqual(asked, ["daysPerWeek", "hoursPerDay", "tools", "payer", "monthlyFeeKrw", "limitHit", "taskKinds", "mainTask", "taskSize", "wishes", "pain"])
  assert.deepEqual(coverage(facts), { usage: 100, tasks: 100, wishes: 100 })
  assert.equal(isComplete(facts), true)
  assert.equal(fallbackAsk(facts), null)
})

test("모델 질문 → 폼: 범위는 코드가 정하고 보기 이름만 모델 것을 쓴다", () => {
  const ask = normalizeAsk({
    question: "  회사 일에  AI 를 얼마나 쓰세요? ",
    fields: [
      { slot: "daysPerWeek", kind: "slider", label: "쓰는 날", min: 0, max: 99, step: 3, unit: "개월" },
      { slot: "hoursPerDay", kind: "single", label: "하루" },
    ],
  }, {})
  assert.equal(ask?.question, "회사 일에 AI 를 얼마나 쓰세요?")
  assert.deepEqual(ask?.fields.map((f) => [f.id, f.slot, f.kind, f.min, f.max, f.step, f.unit]), [
    ["f1", "daysPerWeek", "slider", 0, 5, 1, "일"],
    // 숫자 칸에 고르기를 달라고 해도 숫자 폼이다
    ["f2", "hoursPerDay", "slider", 0, 8, 0.5, "시간"],
  ])
})

test("모델 질문 → 폼: 값이 틀린 보기는 버리고, 모자라면 준비된 보기로", () => {
  const some = normalizeAsk({ question: "유료로 쓰세요?", fields: [{ slot: "payer", kind: "single", options: [{ label: "안 써요", value: "none" }, { label: "회사 카드", value: "company" }, { label: "이상한 값", value: "boss" }, { label: "또 회사", value: "company" }] }] }, {})
  assert.deepEqual(some?.fields[0].options?.map((o) => [o.label, o.value]), [["안 써요", "none"], ["회사 카드", "company"]])
  const none = normalizeAsk({ question: "유료로 쓰세요?", fields: [{ slot: "payer", kind: "multi", options: [{ label: "?", value: "x" }] }] }, {})
  assert.equal(none?.fields[0].kind, "single")
  assert.deepEqual(none?.fields[0].options?.map((o) => o.value), ["none", "company", "personal", "both"])
})

test("모델 질문 → 폼: 작업 보기는 구체적 예시 이름 + 종류 값, 모르는 값은 기타로", () => {
  const ask = normalizeAsk({ question: "어떤 일에 쓰세요?", fields: [{ slot: "taskKinds", kind: "multi", options: [{ label: "메일 초안", value: "write" }, { label: "회의록 요약", value: "summarize" }, { label: "실험 설계", value: "lab" }, { label: "기타", value: "other" }] }] }, {})
  const f = ask!.fields[0]
  assert.equal(f.kind, "multi")
  assert.equal(f.allowOther, true)
  assert.deepEqual(f.options?.map((o) => [o.label, o.value]), [["메일 초안", "write"], ["회의록 요약", "summarize"], ["실험 설계", "other"]])
})

test("가장 많이 하는 작업의 보기는 앞에서 고른 작업 안에서만", () => {
  const facts: Facts = { taskKinds: { ...t(), values: ["write", "code"] } }
  const ask = normalizeAsk({ question: "가장 많이 하는 일은?", fields: [{ slot: "mainTask", kind: "single", options: [{ label: "보고서", value: "write" }, { label: "번역", value: "translate" }, { label: "스크립트", value: "code" }] }] }, facts)
  assert.deepEqual(ask?.fields[0].options?.map((o) => o.value), ["write", "code"])
})

test("거부 — 이미 답한 칸 · 아직 못 묻는 칸 · 모르는 칸 · 빈 질문이면 폼을 만들지 않는다", () => {
  const facts: Facts = { daysPerWeek: { ...t(), num: 3 } }
  assert.equal(normalizeAsk({ question: "며칠 쓰세요?", fields: [{ slot: "daysPerWeek", kind: "slider" }] }, facts), null, "이미 답한 칸")
  assert.equal(normalizeAsk({ question: "얼마 내세요?", fields: [{ slot: "monthlyFeeKrw", kind: "number" }] }, facts), null, "유료 여부를 모르는데 금액부터")
  assert.equal(normalizeAsk({ question: "?", fields: [{ slot: "salary", kind: "number" }] }, facts), null, "없는 칸")
  assert.equal(normalizeAsk({ question: "   ", fields: [{ slot: "tools", kind: "multi" }] }, facts), null, "빈 질문")
  assert.equal(normalizeAsk({ question: "질문", fields: [] }, facts), null)
  assert.equal(normalizeAsk(null, facts), null)
})

test("거부 — 후속 질문(free)만으로는 나아가지 않고, 3번을 넘기면 버린다", () => {
  const free = { slot: "free", kind: "scale", options: [{ label: "불만", value: null }, { label: "만족", value: null }] }
  assert.equal(normalizeAsk({ question: "만족하세요?", fields: [free] }, {}), null, "남은 칸이 있는데 free 만")
  const both = normalizeAsk({ question: "만족하세요?", fields: [free, { slot: "tools", kind: "multi" }] }, {})
  assert.deepEqual(both?.fields.map((f) => [f.slot, f.kind]), [["free", "scale"], ["tools", "multi"]])
  assert.deepEqual([both?.fields[0].minLabel, both?.fields[0].maxLabel], ["불만", "만족"])
  const capped = normalizeAsk({ question: "만족하세요?", fields: [free, { slot: "tools", kind: "multi" }] }, {}, MAX_FREE_TURNS)
  assert.deepEqual(capped?.fields.map((f) => f.slot), ["tools"])
  assert.equal(freeTurns([{ ask: both! }, { ask: capped! }]), 1)
})

test("거부 — free 폼의 범위가 뒤집혔거나 보기가 하나면 버린다", () => {
  const tools = { slot: "tools", kind: "multi" }
  assert.deepEqual(normalizeAsk({ question: "q", fields: [{ slot: "free", kind: "slider", min: 10, max: 2 }, tools] }, {})?.fields.map((f) => f.slot), ["tools"])
  assert.deepEqual(normalizeAsk({ question: "q", fields: [{ slot: "free", kind: "single", options: [{ label: "하나", value: null }] }, tools] }, {})?.fields.map((f) => f.slot), ["tools"])
  assert.deepEqual(normalizeAsk({ question: "q", fields: [{ slot: "free", kind: "dropdown" }, tools] }, {})?.fields.map((f) => f.slot), ["tools"])
})

test("한 번에 칸 3개까지, 시간과 횟수를 함께 묻지 않는다", () => {
  const ask = normalizeAsk({ question: "q", fields: [{ slot: "hoursPerDay" }, { slot: "sessionsPerDay" }, { slot: "tools" }, { slot: "payer" }, { slot: "limitHit" }] }, {})
  assert.deepEqual(ask?.fields.map((f) => f.slot), ["hoursPerDay", "tools", "payer"])
})

const FORM: Ask = {
  question: "q",
  fields: [
    { id: "f1", slot: "payer", kind: "single", options: [{ id: "o1", label: "없음", value: "none" }, { id: "o2", label: "회사", value: "company" }] },
    { id: "f2", slot: "wishes", kind: "multi", allowOther: true, options: [{ id: "o1", label: "메일 초안", value: "write" }, { id: "o2", label: "실험 설계", value: "other" }] },
    { id: "f3", slot: "daysPerWeek", kind: "slider", min: 0, max: 5, step: 1, unit: "일" },
  ],
}
const ok = { f1: { choice: ["o2"] }, f2: { choice: ["o1"], other: "특허 검색" }, f3: { num: 3 } }

test("응답 검사 — 폼에 맞으면 통과, 「잘 모르겠음」 은 어느 칸이든 통과", () => {
  assert.equal(validateAnswer(FORM, ok), null)
  assert.equal(validateAnswer(FORM, { f1: { unknown: true }, f2: { unknown: true }, f3: { unknown: true } }), null)
  assert.equal(validateAnswer(FORM, { ...ok, f2: { choice: [], other: "기타만" } }), null)
})

test("거부 — 빠진 칸 · 없는 보기 · 하나만 고를 칸에 둘 · 범위 밖 숫자 · 폼에 없는 칸", () => {
  assert.match(validateAnswer(FORM, { f1: ok.f1, f2: ok.f2 })!, /답하지 않은/)
  assert.match(validateAnswer(FORM, { ...ok, f1: { choice: ["o9"] } })!, /없는 보기/)
  assert.match(validateAnswer(FORM, { ...ok, f1: { choice: ["o1", "o2"] } })!, /하나만/)
  assert.match(validateAnswer(FORM, { ...ok, f1: { choice: ["o1"], other: "직접" } })!, /기타를 받지/)
  assert.match(validateAnswer(FORM, { ...ok, f2: { choice: [] } })!, /골라/)
  assert.match(validateAnswer(FORM, { ...ok, f2: { choice: ["o1", "o1"] } })!, /없는 보기/)
  assert.match(validateAnswer(FORM, { ...ok, f2: { choice: ["o1"], other: "가".repeat(81) } })!, /80자/)
  assert.match(validateAnswer(FORM, { ...ok, f3: { num: 6 } })!, /범위/)
  assert.match(validateAnswer(FORM, { ...ok, f3: { num: "3" } })!, /숫자/)
  assert.match(validateAnswer(FORM, { ...ok, f3: { num: NaN } })!, /숫자/)
  assert.match(validateAnswer(FORM, { ...ok, f9: { num: 1 } })!, /폼에 없는 칸/)
  assert.match(validateAnswer(FORM, null)!, /모양/)
  assert.match(validateAnswer(FORM, [])!, /모양/)
})

test("거부 — 척도는 1~5 정수, 글은 비면 안 되고 120자까지", () => {
  const form: Ask = { question: "q", fields: [{ id: "f1", slot: "free", kind: "scale", min: 1, max: 5 }, { id: "f2", slot: "free", kind: "text" }] }
  assert.equal(validateAnswer(form, { f1: { num: 4 }, f2: { text: "좋아요" } }), null)
  assert.match(validateAnswer(form, { f1: { num: 2.5 }, f2: { text: "좋아요" } })!, /1~5/)
  assert.match(validateAnswer(form, { f1: { num: 0 }, f2: { text: "좋아요" } })!, /범위/)
  assert.match(validateAnswer(form, { f1: { num: 4 }, f2: { text: "  " } })!, /적어/)
  assert.match(validateAnswer(form, { f1: { num: 4 }, f2: { text: "가".repeat(121) } })!, /120자/)
})

test("응답 → 칸: 값 · 보기 이름 · 근거 턴이 남고, 기타 글은 따로 남는다", () => {
  const facts = applyAnswer({}, FORM, ok, "turn-7")
  assert.deepEqual(facts.payer, { turnId: "turn-7", labels: ["회사"], values: ["company"] })
  assert.deepEqual(facts.wishes, { turnId: "turn-7", labels: ["메일 초안", "특허 검색"], values: ["write", "other"], others: ["특허 검색"] })
  assert.deepEqual(facts.daysPerWeek, { turnId: "turn-7", num: 3 })
  assert.deepEqual(applyAnswer({}, FORM, { f1: { unknown: true }, f2: { choice: ["o2"] }, f3: { num: 0 } }, "x").wishes, { turnId: "x", labels: ["실험 설계"], values: ["other"], others: ["실험 설계"] })
  assert.deepEqual(applyAnswer({}, FORM, { f1: { unknown: true }, f2: ok.f2, f3: ok.f3 }, "x").payer, { turnId: "x", unknown: true })
})

test("도구 · 아쉬운 점은 이름 그대로 남는다(값 목록 없음), 후속 질문은 칸에 넣지 않는다", () => {
  const form: Ask = { question: "q", fields: [{ id: "f1", slot: "tools", kind: "multi", allowOther: true, options: [{ id: "o1", label: "ChatGPT" }, { id: "o2", label: "Claude" }] }, { id: "f2", slot: "free", kind: "text" }] }
  const facts = applyAnswer({}, form, { f1: { choice: ["o2"], other: "퍼플렉시티" }, f2: { text: "메모" } }, "t1")
  assert.deepEqual(facts, { tools: { turnId: "t1", labels: ["Claude", "퍼플렉시티"] } })
})

test("응답을 글로 — 지난 답 목록 · 모델에게 주는 기록", () => {
  assert.equal(answerText(FORM.fields[1], ok.f2), "메일 초안, 특허 검색")
  assert.equal(answerText(FORM.fields[2], ok.f3), "3일")
  assert.equal(answerText(FORM.fields[2], { unknown: true }), "잘 모르겠음")
  assert.equal(answerText({ id: "f", slot: "free", kind: "scale" }, { num: 4 }), "4 / 5")
  assert.equal(answerText(FORM.fields[0], undefined), "")
})

test("모델 지시 — 칸 전부와 값 목록이 들어 있고, 기록에는 답한 문답만 실린다", () => {
  for (const s of SLOT_NAMES) assert.ok(SURVEY_SYSTEM.includes(`- ${s}:`), `${s} 안내`)
  assert.match(SURVEY_SYSTEM, /short_qa\(짧은 질문\)/)
  assert.match(SURVEY_SYSTEM, /잘 모르겠음/)
  assert.equal(transcript([]), "(아직 없음 — 첫 질문이다)")
  const turns = [
    { id: "a", ask: FORM, answer: ok, askedAt: "", source: "model" as const, ms: { first: 1, total: 2 } },
    { id: "b", ask: FORM, askedAt: "", source: "model" as const, ms: { first: 1, total: 2 } },
  ]
  const text = transcript(turns)
  assert.match(text, /1\. 질문: q/)
  assert.match(text, /회사 \/ 메일 초안, 특허 검색 \/ 3일/)
  assert.ok(!text.includes("2. 질문"), "아직 답하지 않은 질문은 싣지 않는다")
  const p = surveyPrompt(turns, applyAnswer({}, FORM, ok, "a"), 0)
  assert.match(p, /남은 칸: hoursPerDay, sessionsPerDay, tools, monthlyFeeKrw, limitHit, taskKinds, taskSize, pain/)
  assert.match(p, /free 는 더 쓸 수 없다/)
})

test("모델 출력 스키마 — 모양이 맞으면 통과, 칸 이름이 틀리면 거부", () => {
  const good = { question: "q", fields: [{ slot: "tools", kind: "multi", label: null, options: [{ label: "ChatGPT", value: null }], min: null, max: null, step: null, unit: null }] }
  assert.equal(AskOutputSchema.safeParse(good).success, true)
  assert.equal(AskOutputSchema.safeParse({ ...good, fields: [{ ...good.fields[0], slot: "salary" }] }).success, false)
  assert.equal(AskOutputSchema.safeParse({ question: "q" }).success, false)
})

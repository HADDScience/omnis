// AI 활용 설문 — DB · 모델 쪽. 규칙은 rules.ts · metrics.ts(순수).
//
// 한 턴 = 응답 저장(중간 저장) → 남은 칸이 있으면 다음 질문(모델, 못 쓰면 준비된 질문) → 다 찼으면 요약 · 확인.
// 모델은 옴니스 에이전트와 같은 것(lib/ai-models.ts 의 agent)을 낮은 추론으로 부른다. 비용은 AiUsage(feature "survey")에
// 남아 #183 상한(lib/ai-budget.ts)에 그대로 잡힌다. 상한에 닿았으면 설문을 막지 않고 준비된 질문으로 이어 간다.
import { randomUUID } from "node:crypto"
import { Output, generateText, streamText } from "ai"
import { prisma } from "@/lib/db"
import { Prisma } from "@/generated/prisma/client"
import { modelFor, modelKey } from "@/lib/ai-models"
import { costOf } from "@/lib/ai-pricing"
import { budgetGate } from "@/lib/ai-budget"
import { checkBudgetAlertsSoon } from "@/lib/ai-budget-alerts"
import { realModel } from "@/lib/agent/model"
import { fakeAgentEnabled } from "@/lib/agent/fake-model"
import { computeMetrics, summaryText, type Metrics } from "./metrics"
import { AskOutputSchema, SAY_SYSTEM, SURVEY_SYSTEM, SayOutputSchema, sayPrompt, surveyPrompt } from "./prompt"
import {
  MAX_FREE_TURNS, MAX_TURNS, SAY_MAX, coverage, editTurn, factsOf, fallbackAsk, freeTurns, guessSay, isComplete, normalizeAsk, pendingNeeded, resolveSay, turnDead, validateAnswer,
  type AnswerValues, type Ask, type Facts, type Purpose, type RawSay, type Turn,
} from "./rules"

export type SurveyStatus = "NONE" | "IN_PROGRESS" | "CONFIRM" | "SUBMITTED"

/** 화면에 내리는 질문 — dead 는 저장하지 않고 그때그때 낸다(앞 답이 바뀌어 더 쓰이지 않는 답) */
export type TurnView = Turn & { dead?: true }

export interface SurveyState {
  status: SurveyStatus
  turns: TurnView[]
  coverage: Record<Purpose, number>
  summary: string | null
  metrics: Metrics | null
  submittedAt: string | null
}

/** 화면으로 흘려보내는 조각(NDJSON 한 줄씩) */
export type SurveyEvent =
  | { t: "coverage"; coverage: Record<Purpose, number> }
  /** 만들어지는 중인 질문 글(지금까지 전부) */
  | { t: "q"; text: string }
  | { t: "state"; state: SurveyState }
  /** 옴니스의 짧은 말 — 못 알아들었을 때. 저장하지 않는다 */
  | { t: "note"; text: string }
  /** 범위 칸을 말로 답하거나 고치려 했다 — 화면이 그 질문의 범위 입력을 이 값으로 맞춰 띄운다 */
  | { t: "range"; turnId: string; fieldId: string; num: number | null }
  | { t: "error"; status: number; error: string }

const KEY_ENV = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", google: "GEMINI_API_KEY" } as const
const MODEL_TIMEOUT_MS = 20_000

type Row = { id: string; status: string; turns: unknown; facts: unknown; summary: string | null; metrics: unknown; submittedAt: Date | null; updatedAt: Date }

const json = (v: unknown) => v as Prisma.InputJsonValue

function stateOf(row: Row | null): SurveyState {
  if (!row) return { status: "NONE", turns: [], coverage: coverage({}), summary: null, metrics: null, submittedAt: null }
  return {
    status: row.status as SurveyStatus,
    turns: (row.turns as Turn[]).map((t) => (turnDead(t, row.facts as Facts) ? { ...t, dead: true as const } : t)),
    coverage: coverage(row.facts as Facts),
    summary: row.summary,
    metrics: (row.metrics as Metrics | null) ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
  }
}

export async function getSurvey(userId: string): Promise<SurveyState> {
  return stateOf(await prisma.aiSurvey.findUnique({ where: { userId } }))
}

/** 모델을 쓸 수 있나 — 시험 모델 · 키 없음 · 비용 상한 도달이면 준비된 질문으로 간다 */
async function modelAvailable(userId: string): Promise<boolean> {
  if (fakeAgentEnabled()) return false
  if (!process.env[KEY_ENV[modelFor("agent").vendor]]) return false
  return (await budgetGate(userId)) === null
}

type Usage = { inputTokens?: number; outputTokens?: number; inputTokenDetails?: { cacheReadTokens?: number }; outputTokenDetails?: { reasoningTokens?: number } }

/** 모델 호출 한 번의 비용을 남긴다 — #183 상한이 읽는 AiUsage */
async function recordUsage(userId: string, usage: Usage): Promise<void> {
  const choice = modelFor("agent")
  const u = {
    inputTokens: usage.inputTokens ?? 0,
    cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  }
  const cost = costOf(modelKey(choice), u)
  await prisma.aiUsage.create({
    data: {
      vendor: choice.vendor, model: choice.model, feature: "survey",
      ...u, reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
      costUsd: cost.usd, costKrw: cost.krw, userId,
    },
  })
  await checkBudgetAlertsSoon()
}

const openaiOptions = () => (modelFor("agent").vendor === "openai" ? { providerOptions: { openai: { store: false } } } : {})

/** 다음 질문을 모델로 만든다. 못 만들면 ask = null */
async function modelAsk(userId: string, turns: Turn[], facts: Facts, started: number, onQuestion: (text: string) => void): Promise<{ ask: Ask | null; first: number | null }> {
  const choice = modelFor("agent")
  const freeUsed = freeTurns(turns)
  let first: number | null = null
  try {
    const result = streamText({
      model: await realModel(choice),
      // 질문 하나 만드는 일이라 가볍게 — 응답 대기를 줄인다
      reasoning: "low",
      instructions: SURVEY_SYSTEM,
      prompt: surveyPrompt(turns, facts, MAX_FREE_TURNS - freeUsed),
      output: Output.object({ schema: AskOutputSchema }),
      maxOutputTokens: 1200,
      abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      ...openaiOptions(),
      onError: ({ error }) => console.error("[ai-survey] 모델 오류", error),
    })
    let shown = ""
    for await (const partial of result.partialOutputStream) {
      const q = typeof partial?.question === "string" ? partial.question : ""
      if (q && q !== shown) {
        if (first === null) first = Date.now() - started
        shown = q
        onQuestion(q)
      }
    }
    const [out, usage] = await Promise.all([result.output, result.usage])
    await recordUsage(userId, usage)
    return { ask: normalizeAsk(out, facts, freeUsed), first }
  } catch (err) {
    console.error("[ai-survey] 질문 생성 실패 — 준비된 질문으로", err)
    return { ask: null, first }
  }
}

/** 입력창에 쓴 글을 모델로 읽는다. 못 읽으면 null — 부르는 쪽이 guessSay 로 읽는다 */
async function modelSay(userId: string, text: string, turns: Turn[], only?: string): Promise<RawSay | null> {
  try {
    const r = await generateText({
      model: await realModel(modelFor("agent")),
      reasoning: "low",
      instructions: SAY_SYSTEM,
      prompt: sayPrompt(text, turns, only),
      output: Output.object({ schema: SayOutputSchema }),
      maxOutputTokens: 600,
      abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      ...openaiOptions(),
    })
    await recordUsage(userId, r.usage)
    return r.output
  } catch (err) {
    console.error("[ai-survey] 글 읽기 실패 — 규칙으로 읽는다", err)
    return null
  }
}

const UNCLEAR = {
  "no-target": "어느 답에 대한 말씀인지 잘 모르겠어요. 추천 답을 누르거나 다시 말씀해 주세요.",
  "not-asked": "그건 아직 여쭤보지 않았어요. 차례가 되면 답해 주세요.",
  "no-value": "보기 가운데 어느 쪽인지 잘 모르겠어요. 추천 답을 눌러 주시겠어요?",
} as const

export interface AdvanceInput {
  /** 지금 묻는 질문에 폼(범위 입력 · 추천 칩)으로 답한다 */
  answer?: { turnId: string; values: unknown }
  /** 지난 답 하나를 그 질문의 폼으로 고친다 — 대화를 되돌리지 않는다 */
  edit?: { turnId: string; values: unknown }
  /** 입력창에 쓴 글 — 지금 질문의 답이거나 앞 답을 고치는 말. turnId 는 말풍선을 눌러 고치는 중인 질문 */
  say?: { text: string; turnId?: string }
  /** 화면에서 잰 그 질문의 대기 시간 */
  seen?: { turnId: string; first: number; ready: number }
}

/**
 * 한 턴 나아간다. 조각은 emit 으로 흘리고 마지막에 state 를 낸다.
 * 답을 받거나 고치면 칸을 처음부터 다시 만든다(factsOf) — 고친 답 때문에 필요 없어진 칸은 지워지고,
 * 새로 열린 칸은 대화 끝에 이어서 묻는다. 같은 요청이 두 번 와도 한 번만 먹는다(updatedAt 이 바뀌었으면 409).
 */
export async function advanceSurvey(userId: string, input: AdvanceInput, emit: (e: SurveyEvent) => void): Promise<void> {
  const started = Date.now()
  let row: Row = await prisma.aiSurvey.upsert({ where: { userId }, create: { userId }, update: {} })
  if (row.status === "SUBMITTED") return emit({ t: "error", status: 409, error: "이미 제출한 설문입니다" })

  let turns = row.turns as Turn[]
  const now = () => new Date().toISOString()

  const save = async (data: Prisma.AiSurveyUpdateManyMutationInput): Promise<boolean> => {
    const r = await prisma.aiSurvey.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data })
    if (r.count !== 1) return false
    row = await prisma.aiSurvey.findUniqueOrThrow({ where: { id: row.id } })
    return true
  }
  const conflict = () => emit({ t: "error", status: 409, error: "다른 곳에서 설문이 진행됐어요. 새로고침해 주세요" })
  const same = () => emit({ t: "state", state: stateOf(row) })

  /** 지금 묻는 질문이면 답하고, 이미 답한 질문이면 그 자리에서 고친다 */
  const put = (turnId: string, values: AnswerValues): boolean => {
    const i = turns.findIndex((t) => t.id === turnId)
    if (i < 0) return false
    if (!turns[i].answer) {
      const seen = input.seen?.turnId === turnId && Number.isFinite(input.seen.first) && Number.isFinite(input.seen.ready)
        ? { clientMs: { first: Math.round(input.seen.first), ready: Math.round(input.seen.ready) } }
        : {}
      turns = turns.map((t, n) => (n === i ? { ...t, answer: values, answeredAt: now(), ...seen } : t))
      return true
    }
    const next = editTurn(turns, turnId, values, now())
    if (!next) return false
    turns = next
    return true
  }

  if (input.answer) {
    const last = turns.at(-1)
    if (!last || last.answer || last.id !== input.answer.turnId) return emit({ t: "error", status: 409, error: "지금 질문에 대한 응답이 아닙니다" })
    const bad = validateAnswer(last.ask, input.answer.values)
    if (bad) return emit({ t: "error", status: 400, error: bad })
    put(last.id, input.answer.values as AnswerValues)
  } else if (input.edit) {
    const target = turns.find((t) => t.id === input.edit!.turnId)
    if (!target?.answer) return emit({ t: "error", status: 400, error: "고칠 수 없는 질문입니다" })
    const bad = validateAnswer(target.ask, input.edit.values)
    if (bad) return emit({ t: "error", status: 400, error: bad })
    put(target.id, input.edit.values as AnswerValues)
  } else if (input.say) {
    const text = input.say.text.replace(/\s+/g, " ").trim().slice(0, SAY_MAX)
    if (!text) return emit({ t: "error", status: 400, error: "내용을 적어 주세요" })
    if (turns.length === 0) return emit({ t: "error", status: 409, error: "아직 시작하지 않은 설문입니다" })
    const only = input.say.turnId
    if (only && !turns.some((t) => t.id === only)) return emit({ t: "error", status: 400, error: "고칠 수 없는 질문입니다" })
    const raw = ((await modelAvailable(userId)) ? await modelSay(userId, text, turns, only) : null) ?? guessSay(text, turns, only)
    const res = resolveSay(raw, text, turns, only)
    if (res.kind === "unclear") {
      emit({ t: "note", text: UNCLEAR[res.reason] })
      return same()
    }
    if (res.kind === "range") {
      // 범위 칸은 글로 확정하지 않는다 — 화면이 범위 입력을 띄워 응답자가 확정한다
      emit({ t: "range", turnId: res.turnId, fieldId: res.fieldId, num: res.num })
      return same()
    }
    put(res.turnId, res.answer)
  } else {
    // 시작 · 이어하기 — 묻던 질문이 있거나 요약을 확인하는 중이면 그대로 다시 보인다
    const last = turns.at(-1)
    if ((last && !last.answer) || row.status === "CONFIRM") return same()
  }

  // 칸을 다시 만든다. 고친 답 때문에 물을 필요가 없어진 질문은 걷는다
  let facts = factsOf(turns)
  const pending = turns.at(-1)
  if (pending && !pending.answer && !pendingNeeded(pending, facts)) {
    turns = turns.slice(0, -1)
    facts = factsOf(turns)
  }
  // 중간 저장 — 다음 질문을 만들다 끊겨도 이 응답은 남는다
  if (turns !== (row.turns as Turn[])) {
    if (!(await save({ turns: json(turns), facts: json(facts), status: "IN_PROGRESS", summary: null, metrics: Prisma.DbNull }))) return conflict()
    emit({ t: "coverage", coverage: coverage(facts) })
  }

  const finish = async () => {
    const metrics = computeMetrics(facts)
    if (!(await save({ status: "CONFIRM", metrics: json(metrics), summary: summaryText(metrics) }))) return conflict()
    return same()
  }
  const last = turns.at(-1)
  // 묻던 질문이 아직 남아 있다(앞 답만 고쳤다) — 그 질문을 이어서 받는다
  if (last && !last.answer) return same()
  if (isComplete(facts) || turns.length >= MAX_TURNS) return finish()

  let ask: Ask | null = null
  let first: number | null = null
  let source: Turn["source"] = "fallback"
  if (await modelAvailable(userId)) {
    const r = await modelAsk(userId, turns, facts, started, (text) => emit({ t: "q", text }))
    ask = r.ask
    first = r.first
    if (ask) source = "model"
  }
  ask ??= fallbackAsk(facts)
  // 남은 칸은 앞 칸을 기다리는 것뿐인데 물을 것이 없다 — 있는 답으로 마무리한다
  if (!ask) return finish()
  const total = Date.now() - started
  const basis = turns.findLast((t) => t.answer)?.id
  const turn: Turn = { id: randomUUID(), ask, askedAt: now(), ...(basis ? { basis } : {}), source, ms: { first: source === "model" ? first : total, total } }
  turns = [...turns, turn]
  if (!(await save({ turns: json(turns) }))) return conflict()
  same()
}

export type SubmitResult = { ok: true; state: SurveyState } | { ok: false; status: number; error: string }

/** 응답자가 요약을 확인하고 제출한다 */
export async function submitSurvey(userId: string): Promise<SubmitResult> {
  const row = await prisma.aiSurvey.findUnique({ where: { userId } })
  if (!row) return { ok: false, status: 404, error: "설문이 없습니다" }
  if (row.status === "SUBMITTED") return { ok: true, state: stateOf(row) }
  if (row.status !== "CONFIRM") return { ok: false, status: 409, error: "아직 답하지 않은 질문이 있습니다" }
  const r = await prisma.aiSurvey.updateMany({ where: { id: row.id, status: "CONFIRM" }, data: { status: "SUBMITTED", submittedAt: new Date() } })
  if (r.count !== 1) return { ok: false, status: 409, error: "다른 곳에서 설문이 바뀌었어요. 새로고침해 주세요" }
  return { ok: true, state: stateOf(await prisma.aiSurvey.findUnique({ where: { userId } })) }
}

/** 처음부터 다시 — 내 설문을 지운다(제출한 것도) */
export async function resetSurvey(userId: string): Promise<void> {
  await prisma.aiSurvey.deleteMany({ where: { userId } })
}

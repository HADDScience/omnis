// AI 활용 설문 — DB · 모델 쪽. 규칙은 rules.ts · metrics.ts(순수).
//
// 한 턴 = 응답 저장(중간 저장) → 남은 칸이 있으면 다음 질문(모델, 못 쓰면 준비된 질문) → 다 찼으면 요약 · 확인.
// 모델은 옴니스 에이전트와 같은 것(lib/ai-models.ts 의 agent)을 낮은 추론으로 부른다. 비용은 AiUsage(feature "survey")에
// 남아 #183 상한(lib/ai-budget.ts)에 그대로 잡힌다. 상한에 닿았으면 설문을 막지 않고 준비된 질문으로 이어 간다.
import { randomUUID } from "node:crypto"
import { Output, streamText } from "ai"
import { prisma } from "@/lib/db"
import { Prisma } from "@/generated/prisma/client"
import { modelFor, modelKey } from "@/lib/ai-models"
import { costOf } from "@/lib/ai-pricing"
import { budgetGate } from "@/lib/ai-budget"
import { checkBudgetAlertsSoon } from "@/lib/ai-budget-alerts"
import { realModel } from "@/lib/agent/model"
import { fakeAgentEnabled } from "@/lib/agent/fake-model"
import { computeMetrics, summaryText, type Metrics } from "./metrics"
import { AskOutputSchema, SURVEY_SYSTEM, surveyPrompt } from "./prompt"
import {
  MAX_FREE_TURNS, MAX_TURNS, applyAnswer, coverage, fallbackAsk, freeTurns, isComplete, normalizeAsk, validateAnswer,
  type AnswerValues, type Ask, type Facts, type Purpose, type Turn,
} from "./rules"

export type SurveyStatus = "NONE" | "IN_PROGRESS" | "CONFIRM" | "SUBMITTED"

export interface SurveyState {
  status: SurveyStatus
  turns: Turn[]
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
  | { t: "error"; status: number; error: string }

const KEY_ENV = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", google: "GEMINI_API_KEY" } as const
const MODEL_TIMEOUT_MS = 20_000

type Row = { id: string; status: string; turns: unknown; facts: unknown; summary: string | null; metrics: unknown; submittedAt: Date | null; updatedAt: Date }

const json = (v: unknown) => v as Prisma.InputJsonValue

function stateOf(row: Row | null): SurveyState {
  if (!row) return { status: "NONE", turns: [], coverage: coverage({}), summary: null, metrics: null, submittedAt: null }
  return {
    status: row.status as SurveyStatus,
    turns: row.turns as Turn[],
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
      ...(choice.vendor === "openai" ? { providerOptions: { openai: { store: false } } } : {}),
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
    return { ask: normalizeAsk(out, facts, freeUsed), first }
  } catch (err) {
    console.error("[ai-survey] 질문 생성 실패 — 준비된 질문으로", err)
    return { ask: null, first }
  }
}

export interface AdvanceInput {
  /** 마지막 질문에 대한 응답. 없으면 시작 · 이어하기 */
  answer?: { turnId: string; values: unknown }
  /** 화면에서 잰 그 질문의 대기 시간 */
  seen?: { turnId: string; first: number; ready: number }
}

/**
 * 한 턴 나아간다. 조각은 emit 으로 흘리고 마지막에 state 를 낸다.
 * 같은 응답이 두 번 와도(더블탭 · 재시도) 한 번만 먹는다 — updatedAt 이 바뀌었으면 409.
 */
export async function advanceSurvey(userId: string, input: AdvanceInput, emit: (e: SurveyEvent) => void): Promise<void> {
  const started = Date.now()
  let row: Row = await prisma.aiSurvey.upsert({ where: { userId }, create: { userId }, update: {} })
  if (row.status === "SUBMITTED") return emit({ t: "error", status: 409, error: "이미 제출한 설문입니다" })

  let turns = row.turns as Turn[]
  let facts = row.facts as Facts
  const last = turns.at(-1)

  const save = async (data: Prisma.AiSurveyUpdateManyMutationInput): Promise<boolean> => {
    const r = await prisma.aiSurvey.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data })
    if (r.count !== 1) return false
    row = await prisma.aiSurvey.findUniqueOrThrow({ where: { id: row.id } })
    return true
  }
  const conflict = () => emit({ t: "error", status: 409, error: "다른 곳에서 설문이 진행됐어요. 새로고침해 주세요" })

  if (input.answer) {
    if (!last || last.answer || last.id !== input.answer.turnId) return emit({ t: "error", status: 409, error: "지금 질문에 대한 응답이 아닙니다" })
    const bad = validateAnswer(last.ask, input.answer.values)
    if (bad) return emit({ t: "error", status: 400, error: bad })
    const values = input.answer.values as AnswerValues
    const seen = input.seen?.turnId === last.id && Number.isFinite(input.seen.first) && Number.isFinite(input.seen.ready)
      ? { clientMs: { first: Math.round(input.seen.first), ready: Math.round(input.seen.ready) } }
      : {}
    turns = [...turns.slice(0, -1), { ...last, answer: values, answeredAt: new Date().toISOString(), ...seen }]
    facts = applyAnswer(facts, last.ask, values, last.id)
    // 중간 저장 — 다음 질문을 만들다 끊겨도 이 응답은 남는다
    if (!(await save({ turns: json(turns), facts: json(facts), status: "IN_PROGRESS", summary: null, metrics: Prisma.DbNull }))) return conflict()
    emit({ t: "coverage", coverage: coverage(facts) })
  } else if (last && !last.answer) {
    // 이어하기 — 묻던 질문을 그대로 다시 보인다
    return emit({ t: "state", state: stateOf(row) })
  } else if (row.status === "CONFIRM") {
    return emit({ t: "state", state: stateOf(row) })
  }

  if (isComplete(facts) || turns.length >= MAX_TURNS) {
    const metrics = computeMetrics(facts)
    if (!(await save({ status: "CONFIRM", metrics: json(metrics), summary: summaryText(metrics) }))) return conflict()
    return emit({ t: "state", state: stateOf(row) })
  }

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
  if (!ask) {
    // 남은 칸은 앞 칸을 기다리는 것뿐인데 물을 것이 없다 — 있는 답으로 마무리한다
    const metrics = computeMetrics(facts)
    if (!(await save({ status: "CONFIRM", metrics: json(metrics), summary: summaryText(metrics) }))) return conflict()
    return emit({ t: "state", state: stateOf(row) })
  }
  const total = Date.now() - started
  const turn: Turn = { id: randomUUID(), ask, askedAt: new Date().toISOString(), source, ms: { first: source === "model" ? first : total, total } }
  if (!(await save({ turns: json([...turns, turn]) }))) return conflict()
  emit({ t: "state", state: stateOf(row) })
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

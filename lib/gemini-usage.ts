import { startOfDay } from "date-fns"
import { prisma } from "@/lib/db"
import { costOf } from "@/lib/ai-pricing"
import { checkBudgetAlertsSoon } from "@/lib/ai-budget-alerts"

// 공개 데모(omnis-omega)는 비밀번호가 README 에 공개돼 있어 env 로 한도를 낮춘다. 없으면 기본값.
const envLimit = (name: string, fallback: number) => {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const DAILY_GEMINI_CALL_LIMIT = envLimit("GEMINI_DAILY_CALL_LIMIT", 500)
export const DAILY_GEMINI_TOKEN_LIMIT = envLimit("GEMINI_DAILY_TOKEN_LIMIT", 1_000_000)

export interface GeminiUsageSnapshot {
  calls: number
  tokens: number
}

export interface GeminiUsageLimits {
  dailyCalls: number
  dailyTokens: number
}

export const GEMINI_USAGE_LIMITS: GeminiUsageLimits = {
  dailyCalls: DAILY_GEMINI_CALL_LIMIT,
  dailyTokens: DAILY_GEMINI_TOKEN_LIMIT,
}

export function currentGeminiUsageWindow(): Date {
  return startOfDay(new Date())
}

export async function readGeminiUsageSnapshot(userId?: string | null): Promise<GeminiUsageSnapshot> {
  const aggregate = await prisma.geminiUsage.aggregate({
    where: {
      createdAt: { gte: currentGeminiUsageWindow() },
      ...(userId ? { userId } : {}),
    },
    _sum: { totalTokens: true },
    _count: true,
  })

  return {
    calls: aggregate._count,
    tokens: aggregate._sum.totalTokens ?? 0,
  }
}

/**
 * 일일 한도에 걸렸다. message 는 로그용 그대로 두고, 사람에게 보일 문장은 `userMessage` 에 둔다 —
 * 화면에 "draft_failed" 만 뜨면 고장인지 한도인지 알 수 없다(2026-10-19 칼럼 초안).
 */
export class GeminiQuotaError extends Error {
  constructor(
    message: string,
    readonly userMessage: string
  ) {
    super(message)
    this.name = "GeminiQuotaError"
  }
}

/** 한도가 다시 열리는 시각. 창은 서버 시간대의 자정부터라(Vercel 은 UTC) 한국시간으로 바꿔 보여 준다. */
function resetLabel(): string {
  const kst = new Date(currentGeminiUsageWindow().getTime() + 24 * 3600 * 1000 + 9 * 3600 * 1000)
  const h = kst.getUTCHours()
  return `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 ${h < 12 ? "오전" : "오후"} ${h % 12 || 12}시`
}

export async function assertGeminiUsageAllowed(input: {
  endpoint: string
  userId?: string | null
  estimatedTokens?: number
}) {
  const usage = await readGeminiUsageSnapshot()
  const n = (x: number) => x.toLocaleString("ko-KR")
  if (usage.calls >= DAILY_GEMINI_CALL_LIMIT) {
    throw new GeminiQuotaError(
      `Gemini 일일 호출 한도 초과: ${usage.calls}/${DAILY_GEMINI_CALL_LIMIT} (endpoint=${input.endpoint})`,
      `오늘 Omnis 의 AI(Gemini) 호출 한도를 다 썼습니다 (${n(usage.calls)} / ${n(DAILY_GEMINI_CALL_LIMIT)}회). ${resetLabel()}(한국시간)에 다시 열립니다.`
    )
  }

  const projectedTokens = usage.tokens + Math.max(input.estimatedTokens ?? 0, 0)
  if (projectedTokens >= DAILY_GEMINI_TOKEN_LIMIT) {
    throw new GeminiQuotaError(
      `Gemini 일일 토큰 한도 초과 예상: ${projectedTokens}/${DAILY_GEMINI_TOKEN_LIMIT} (endpoint=${input.endpoint})`,
      `오늘 Omnis 의 AI(Gemini) 사용 한도를 다 썼습니다 (토큰 ${n(usage.tokens)} / ${n(DAILY_GEMINI_TOKEN_LIMIT)}). ${resetLabel()}(한국시간)에 다시 열립니다.`
    )
  }
}

export async function recordGeminiUsage(input: {
  endpoint: string
  promptTokens: number
  candidateTokens: number
  totalTokens: number
  userId?: string | null
  /** 부른 모델 — 주면 비용(AiUsage)도 함께 남긴다. 2026-11-10 전에는 토큰만 남아 원 환산이 없었다 */
  model?: string
  cachedTokens?: number
}) {
  const gemini = prisma.geminiUsage.create({
    data: {
      endpoint: input.endpoint,
      promptTokens: input.promptTokens,
      candidateTokens: input.candidateTokens,
      totalTokens: input.totalTokens,
      userId: input.userId ?? null,
    },
  })
  if (!input.model) {
    await gemini
    return
  }
  // 비용 기록의 원천은 AiUsage 하나 — 에이전트 · 사진 설명과 같은 표에 같은 환산으로 남긴다(lib/ai-budget.ts 가 읽는다)
  const row = geminiAiUsageRow({ ...input, model: input.model })
  await prisma.$transaction([gemini, prisma.aiUsage.create({ data: row })])
  void checkBudgetAlertsSoon()
}

/** GeminiUsage 한 줄 → AiUsage 한 줄. 출력은 생각(thinking) 토큰을 포함한다(total − prompt) */
export function geminiAiUsageRow(input: {
  endpoint: string; promptTokens: number; candidateTokens: number; totalTokens: number; userId?: string | null; model: string; cachedTokens?: number
}) {
  const inputTokens = Math.max(input.promptTokens, 0)
  const outputTokens = Math.max(input.totalTokens - inputTokens, input.candidateTokens, 0)
  const cached = Math.min(Math.max(input.cachedTokens ?? 0, 0), inputTokens)
  const cost = costOf(`google:${input.model}`, { inputTokens, cachedInputTokens: cached, outputTokens })
  return {
    vendor: "google",
    model: input.model,
    feature: input.endpoint,
    inputTokens,
    cachedInputTokens: cached,
    outputTokens,
    reasoningTokens: Math.max(outputTokens - Math.max(input.candidateTokens, 0), 0),
    costUsd: cost.usd,
    costKrw: cost.krw,
    userId: input.userId ?? null,
  }
}

export function estimateGeminiTokens(texts: string[]): number {
  const chars = texts.reduce((sum, text) => sum + text.length, 0)
  return Math.ceil(chars / 4)
}

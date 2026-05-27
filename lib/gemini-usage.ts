import { startOfDay } from "date-fns"
import { prisma } from "@/lib/db"

export const DAILY_GEMINI_CALL_LIMIT = 500
export const DAILY_GEMINI_TOKEN_LIMIT = 1_000_000

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

export async function assertGeminiUsageAllowed(input: {
  endpoint: string
  userId?: string | null
  estimatedTokens?: number
}) {
  const usage = await readGeminiUsageSnapshot()
  if (usage.calls >= DAILY_GEMINI_CALL_LIMIT) {
    throw new Error(
      `Gemini 일일 호출 한도 초과: ${usage.calls}/${DAILY_GEMINI_CALL_LIMIT} (endpoint=${input.endpoint})`
    )
  }

  const projectedTokens = usage.tokens + Math.max(input.estimatedTokens ?? 0, 0)
  if (projectedTokens >= DAILY_GEMINI_TOKEN_LIMIT) {
    throw new Error(
      `Gemini 일일 토큰 한도 초과 예상: ${projectedTokens}/${DAILY_GEMINI_TOKEN_LIMIT} (endpoint=${input.endpoint})`
    )
  }
}

export async function recordGeminiUsage(input: {
  endpoint: string
  promptTokens: number
  candidateTokens: number
  totalTokens: number
  userId?: string | null
}) {
  await prisma.geminiUsage.create({
    data: {
      endpoint: input.endpoint,
      promptTokens: input.promptTokens,
      candidateTokens: input.candidateTokens,
      totalTokens: input.totalTokens,
      userId: input.userId ?? null,
    },
  })
}

export function estimateGeminiTokens(texts: string[]): number {
  const chars = texts.reduce((sum, text) => sum + text.length, 0)
  return Math.ceil(chars / 4)
}

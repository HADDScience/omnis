// 실행당 상한 — 턴(모델 호출) 수와 원. 순수 함수 — Workflow 안에서 stopWhen 으로 부른다. 시험: lib/agent/limits.test.ts
import { costOf } from "@/lib/ai-pricing"
import type { AgentLimits } from "@/lib/ai-models"

export interface StepUsage {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
}

/** AI SDK 의 step.usage(LanguageModelUsage) → 셀 수 있는 값. 모르는 칸은 0 */
export function usageOf(u: {
  inputTokens?: number
  outputTokens?: number
  inputTokenDetails?: { cacheReadTokens?: number }
  outputTokenDetails?: { reasoningTokens?: number }
} | undefined): StepUsage {
  return {
    inputTokens: u?.inputTokens ?? 0,
    cachedInputTokens: u?.inputTokenDetails?.cacheReadTokens ?? 0,
    outputTokens: u?.outputTokens ?? 0,
    reasoningTokens: u?.outputTokenDetails?.reasoningTokens ?? 0,
  }
}

export interface Spent {
  turns: number
  krw: number
}

export function spentWith(prior: Spent, modelKey: string, steps: StepUsage[]): Spent {
  return {
    turns: prior.turns + steps.length,
    krw: prior.krw + steps.reduce((a, s) => a + costOf(modelKey, s).krw, 0),
  }
}

/** 다음 모델 호출을 하면 안 되는가. 상한에 닿은 이유, 아니면 null */
export function limitReason(spent: Spent, limits: AgentLimits): string | null {
  if (spent.turns >= limits.maxTurns) return `턴 상한(${limits.maxTurns}회)`
  if (spent.krw >= limits.maxKrw) return `비용 상한(${limits.maxKrw}원)`
  return null
}

export function limitMessage(reason: string, spent: Spent): string {
  return `실행 상한에 닿아 여기서 멈췄습니다 — ${reason}. 지금까지 모델 ${spent.turns}회 · 약 ${spent.krw.toFixed(1)}원을 썼습니다. 이어서 하려면 범위를 좁혀 다시 요청해 주세요.`
}

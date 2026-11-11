import { z } from "zod"

const ms = z.number().finite().min(0).max(600_000)

/**
 * POST /api/ai-survey/turn — 응답을 보내고 다음 질문을 받는다. 본문이 비면 시작 · 이어하기.
 * values 의 모양은 그 질문의 폼이 정한다 — lib/ai-survey/rules.ts validateAnswer 가 폼과 대조한다.
 */
export const SurveyTurnSchema = z.object({
  answer: z.object({ turnId: z.string().min(1).max(64), values: z.record(z.string().max(8), z.unknown()) }).optional(),
  /** 화면에서 잰 그 질문의 대기 시간(ms) */
  seen: z.object({ turnId: z.string().min(1).max(64), first: ms, ready: ms }).optional(),
})

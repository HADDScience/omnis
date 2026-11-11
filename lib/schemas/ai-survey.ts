import { z } from "zod"

const ms = z.number().finite().min(0).max(600_000)
const formAnswer = z.object({ turnId: z.string().min(1).max(64), values: z.record(z.string().max(8), z.unknown()) })

/**
 * POST /api/ai-survey/turn — 응답을 보내고 다음 질문을 받는다. 본문이 비면 시작 · 이어하기.
 * values 의 모양은 그 질문의 폼이 정한다 — lib/ai-survey/rules.ts validateAnswer 가 폼과 대조한다.
 */
export const SurveyTurnSchema = z
  .object({
    /** 지금 묻는 질문에 폼(범위 입력 · 추천 칩)으로 답한다 */
    answer: formAnswer.optional(),
    /** 지난 답 하나를 그 질문의 폼으로 고친다 */
    edit: formAnswer.optional(),
    /** 입력창에 쓴 글 — 서버가 칸 값으로 옮긴다. turnId 는 고치는 중인 질문 */
    say: z.object({ text: z.string().min(1).max(300), turnId: z.string().min(1).max(64).optional() }).optional(),
    /** 제출한 뒤 다시 한다 — 새 응답을 시작한다(앞 응답은 기록으로 남는다) */
    restart: z.boolean().optional(),
    /** 화면에서 잰 그 질문의 대기 시간(ms) */
    seen: z.object({ turnId: z.string().min(1).max(64), first: ms, ready: ms }).optional(),
  })
  .refine((v) => [v.answer, v.edit, v.say].filter(Boolean).length <= 1, { message: "한 번에 하나만 보낼 수 있습니다" })

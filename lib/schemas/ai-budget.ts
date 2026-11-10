import { z } from "zod"

const krw = z.number().int().positive().max(100_000_000)

/** PUT /api/ai-budget — 관리자 화면 저장 */
export const SaveBudgetSchema = z.object({
  userDailyKrw: krw,
  monthlyKrw: krw,
  /** 사람별 하루 상한 예외 — userId → 원 */
  users: z.record(z.string().min(1), krw).default({}),
  /** 기능 요청 · 비용 알림 받는 사람. 비우면 ALERT_EMAIL_TO 와 같은 이메일의 계정 */
  recipients: z.array(z.string().min(1)).max(20).default([]),
})

/** POST /api/ai-budget/raise — 한도 도달 안내의 「한도 올리기」 */
export const RaiseBudgetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user_daily"), userId: z.string().min(1), toKrw: krw }),
  z.object({ kind: z.literal("monthly"), toKrw: krw }),
])

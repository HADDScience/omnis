import { z } from "zod"

// 에이전트 · MCP 도구 list_calendar 의 입력 — lib/calendar/agent-tool.ts 가 이 규칙으로 읽는다.
// 날짜는 서울 날짜(YYYY-MM-DD)다. 시각까지 받지 않는다 — 「다음 주」「11/4」 같은 질문은 날 단위다.

const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "날짜는 YYYY-MM-DD 로 주세요")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number)
    const t = new Date(Date.UTC(y, m - 1, d))
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
  }, "없는 날짜입니다")

export const CalendarToolArgsSchema = z.object({
  from: ymd.optional(),
  to: ymd.optional(),
  calendar: z.string().trim().max(100).optional(),
  query: z.string().trim().max(100).optional(),
  all_day: z.boolean().optional(),
})

export type CalendarToolArgs = z.infer<typeof CalendarToolArgsSchema>

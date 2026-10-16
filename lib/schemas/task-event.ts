import { z } from "zod"

/**
 * 업무 변경 이력(`TaskEvent`)의 경로·항목 SSOT. DB 에는 문자열로 들어가고, 쓰는 쪽은 모두 이 스키마를 지난다.
 * 설계: mydocs/plans/2026-10-16-kpi-metrics.md
 */

/**
 * 어디서 바꿨나. web·notification 은 사람이 화면에서, mcp 는 사용자 토큰을 쥔 에이전트가,
 * chat-ai·import 는 사람 손 없이 바꾼 것이다. KPI 는 경로별로 따로 센다.
 */
export const TASK_EVENT_VIA = ["web", "mcp", "chat-ai", "notification", "import"] as const
export const TaskEventViaSchema = z.enum(TASK_EVENT_VIA)
export type TaskEventVia = z.infer<typeof TaskEventViaSchema>

/** 무엇이 바뀌었나. */
export const TASK_EVENT_FIELDS = ["created", "status", "assignees", "deadline", "archived", "checklist"] as const
export const TaskEventFieldSchema = z.enum(TASK_EVENT_FIELDS)
export type TaskEventField = z.infer<typeof TaskEventFieldSchema>

import { z } from "zod"

/**
 * AI structureTask 출력 ↔ DB Task ↔ Form defaultValues 단일 진실 소스 (SSOT).
 * 규칙 13 (omnis/CLAUDE.md): AI 응답 파싱·DB write·Form defaultValues 모두 같은 Zod 스키마 경유.
 *
 * Phase 2 #3: priority / ownerHint / deadlineHint 추가, expectedResult 제거.
 */

export const PRIORITY_VALUES = ["LOW", "NORMAL", "HIGH"] as const
export const PrioritySchema = z.enum(PRIORITY_VALUES)
export type Priority = z.infer<typeof PrioritySchema>

/** AI structureTask가 반환할 카드 초안 */
export const TaskAiDraftSchema = z.object({
  /** 업무명 (15자 이내 권장) */
  name: z.string().min(1).max(120),
  /** 업무 배경/맥락 */
  background: z.string().default(""),
  /** 체크리스트 항목 이름 배열 (2~5개 권장) */
  checklist: z.array(z.string().min(1)).default([]),
  /** 프로젝트 ID (없으면 null). 사용자/AI가 매핑 시 설정 */
  projectId: z.string().nullable().default(null),
  /** 제품 ID (없으면 null). 보통 projectId 선택 시 자동 설정 */
  productId: z.string().nullable().default(null),
  /** 카테고리 ID (없으면 null). #12 결정에 따라 향후 제거 예정 */
  categoryId: z.string().nullable().default(null),
  /** 우선순위 힌트 (AI 추정) — 사용자가 모달에서 확정 */
  priority: PrioritySchema.optional(),
  /** 담당자 힌트 (이름) — 사용자가 모달에서 user 매핑 */
  ownerHint: z.string().optional(),
  /** 마감 힌트 (YYYY-MM-DD 또는 상대표현 "내일", "이번 주 금요일") — 사용자가 모달에서 확정 */
  deadlineHint: z.string().optional(),
})
export type TaskAiDraft = z.infer<typeof TaskAiDraftSchema>

/** Gemini 응답이 다른 키 이름을 쓸 수 있어 미리 정규화하는 헬퍼 */
export function normalizeAiDraft(parsed: Record<string, unknown>): TaskAiDraft {
  const safe = {
    name: (parsed.name ?? parsed.title ?? "새 업무") as string,
    background: (parsed.background ?? parsed.context ?? "") as string,
    checklist: Array.isArray(parsed.checklist)
      ? (parsed.checklist as unknown[])
          .map((c) => (typeof c === "string" ? c : (c as { name?: string; description?: string }).name ?? (c as { description?: string }).description ?? ""))
          .filter((s): s is string => typeof s === "string" && s.length > 0)
      : [],
    projectId: (parsed.projectId ?? null) as string | null,
    productId: (parsed.productId ?? null) as string | null,
    categoryId: (parsed.categoryId ?? null) as string | null,
    priority: (parsed.priority ?? parsed.priorityHint) as Priority | undefined,
    ownerHint: (parsed.ownerHint ?? parsed.owner ?? parsed.assignee) as string | undefined,
    deadlineHint: (parsed.deadlineHint ?? parsed.deadline ?? parsed.dueDate) as string | undefined,
  }
  return TaskAiDraftSchema.parse(safe)
}

/** 빈 fallback 초안 (GEMINI_API_KEY 미설정 시) */
export function fallbackAiDraft(messages: string[]): TaskAiDraft {
  return TaskAiDraftSchema.parse({
    name: messages[0]?.slice(0, 30) ?? "새 업무",
    background: messages.join(" ").slice(0, 200),
    checklist: [],
    projectId: null,
    productId: null,
    categoryId: null,
  })
}

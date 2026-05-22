import { z } from "zod"

/**
 * AI structureTask 출력 ↔ DB Task ↔ Form defaultValues 단일 진실 소스 (SSOT).
 * 규칙 13 (omnis/CLAUDE.md): AI 응답 파싱·DB write·Form defaultValues 모두 같은 Zod 스키마 경유.
 *
 * Phase 2 #3: priority / ownerHint / deadlineHint 추가, expectedResult 제거.
 * Phase 2 #12: categoryId 제거 (사용자 결정 Q1=A — TaskCategory 폐기).
 */

export const PRIORITY_VALUES = ["LOW", "NORMAL", "HIGH"] as const
export const PrioritySchema = z.enum(PRIORITY_VALUES)
export type Priority = z.infer<typeof PrioritySchema>

/**
 * AI가 신규 프로젝트 생성을 제안할 때의 초안.
 * 기존 프로젝트 중 적합한 것이 없을 때 projectId 대신 채워진다.
 */
export const NewProjectDraftSchema = z.object({
  /** 프로젝트명 */
  name: z.string().min(1).max(120),
  /** 프로젝트 목적 */
  purpose: z.string().default(""),
  /** 프로젝트 목표 */
  goal: z.string().default(""),
  /** 관련 제품 ID (없으면 null) */
  productId: z.string().nullable().default(null),
})
export type NewProjectDraft = z.infer<typeof NewProjectDraftSchema>

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
  /** 신규 프로젝트 제안 (기존 프로젝트가 적합하지 않을 때). projectId와 동시에 채우지 않음 */
  newProject: NewProjectDraftSchema.nullable().default(null),
  /** 제품 ID (없으면 null). 보통 projectId 선택 시 자동 설정 */
  productId: z.string().nullable().default(null),
  /** 우선순위 힌트 (AI 추정) — 사용자가 모달에서 확정 */
  priority: PrioritySchema.optional(),
  /** 담당자 힌트 (이름) — 사용자가 모달에서 user 매핑 */
  ownerHint: z.string().optional(),
  /** 마감 힌트 (YYYY-MM-DD 또는 상대표현 "내일", "이번 주 금요일") — 사용자가 모달에서 확정 */
  deadlineHint: z.string().optional(),
})
export type TaskAiDraft = z.infer<typeof TaskAiDraftSchema>

/** Gemini가 newProject(또는 new_project) 키로 반환한 신규 프로젝트 제안을 정규화 */
function normalizeNewProject(parsed: Record<string, unknown>): NewProjectDraft | null {
  const raw = (parsed.newProject ?? parsed.new_project) as Record<string, unknown> | null | undefined
  if (!raw || typeof raw !== "object") return null
  const name = (raw.name ?? raw.title ?? "") as string
  // projectId가 이미 있으면 신규 제안은 무시 (둘 중 하나만 유효)
  if (!name.trim()) return null
  return {
    name: name.trim(),
    purpose: (raw.purpose ?? raw.description ?? "") as string,
    goal: (raw.goal ?? "") as string,
    productId: (raw.productId ?? null) as string | null,
  }
}

/** Gemini 응답이 다른 키 이름을 쓸 수 있어 미리 정규화하는 헬퍼 */
export function normalizeAiDraft(parsed: Record<string, unknown>): TaskAiDraft {
  const projectId = (parsed.projectId ?? null) as string | null
  // projectId가 지정되면 newProject는 무시. 그렇지 않을 때만 신규 제안 채택.
  const newProject = projectId ? null : normalizeNewProject(parsed)
  const safe = {
    name: (parsed.name ?? parsed.title ?? "새 업무") as string,
    background: (parsed.background ?? parsed.context ?? "") as string,
    checklist: Array.isArray(parsed.checklist)
      ? (parsed.checklist as unknown[])
          .map((c) => (typeof c === "string" ? c : (c as { name?: string; description?: string }).name ?? (c as { description?: string }).description ?? ""))
          .filter((s): s is string => typeof s === "string" && s.length > 0)
      : [],
    projectId,
    newProject,
    productId: (parsed.productId ?? null) as string | null,
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
  })
}

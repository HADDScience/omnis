// 국가과제 우리 결정 보드 — 열 나누기 · 옮길 때 보내는 값 · 카드 한 줄. 화면(components/grants/decision-board.tsx)과 시험이 같이 쓴다.
import {
  GRANT_STAGES,
  GRANT_STAGE_LABEL,
  isGrantStage,
  seoulYmd,
  won,
  type GrantStage,
} from "@/lib/grants-labels"

export type BoardView = "list" | "board"
/** 주소의 view → 보기. 모르는 값은 목록 */
export const readBoardView = (v: string | undefined | null): BoardView =>
  v === "board" ? "board" : "list"

/** 보드 열 — 단계 순서 그대로(준비 → … → 중단) */
export const BOARD_COLUMNS = GRANT_STAGES.map((stage) => ({
  stage,
  label: GRANT_STAGE_LABEL[stage],
}))

/** 단계별로 나눈다. 열 안의 순서는 받은 순서(화면은 마감 빠른 순으로 준다) */
export function groupByStage<T extends { stage: GrantStage }>(
  rows: T[]
): Record<GrantStage, T[]> {
  const out = Object.fromEntries(GRANT_STAGES.map((s) => [s, [] as T[]])) as Record<
    GrantStage,
    T[]
  >
  for (const r of rows) out[r.stage].push(r)
  return out
}

/**
 * 카드를 다른 열에 놓을 때 보내는 PATCH 본문 — 제자리 편집과 같이 expect(옮기기 전 단계)를 붙인다.
 * 같은 열이거나 모르는 열이면 null(보내지 않는다)
 */
export function stageMove(
  from: GrantStage,
  to: unknown
): { stage: GrantStage; expect: { stage: GrantStage } } | null {
  if (!isGrantStage(to) || to === from) return null
  return { stage: to, expect: { stage: from } }
}

/** 화면 먼저 옮기기 · 실패하면 되돌리기 — 그 카드 하나의 단계만 바꾼다 */
export const withStage = <T extends { id: string; stage: GrantStage }>(
  rows: T[],
  id: string,
  stage: GrantStage
): T[] => rows.map((r) => (r.id === id ? { ...r, stage } : r))

/** 카드의 지원금액 — 확정 지원금이 있으면 그것(「120,000,000원」), 없으면 적어 둔 지원금액 글 */
export function cardMoney(r: {
  awardedAmount: string | null
  amount: string | null
}): string | null {
  if (r.awardedAmount && /^\d+$/.test(r.awardedAmount))
    return won(BigInt(r.awardedAmount))
  return r.amount?.trim() || null
}

/** 카드의 날짜 — 수행 중은 수행 종료일, 완료는 완료일, 나머지는 마감(목록 한 줄과 같은 규칙) */
export function cardDue(r: {
  stage: GrantStage
  deadline: string | null
  endsOn: string | null
  completedOn: string | null
}): string | null {
  if (r.stage === "IN_PROGRESS") return r.endsOn ? `~ ${seoulYmd(r.endsOn)}` : null
  if (r.stage === "COMPLETED")
    return r.completedOn ? `완료 ${seoulYmd(r.completedOn)}` : null
  return r.deadline ? `마감 ${seoulYmd(r.deadline)}` : null
}

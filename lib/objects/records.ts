// 공통 층 근거 · 이력 · 제안 표(P3)의 값 목록 — 데이터만 둔다.
// 마이그레이션 SQL 의 CHECK 와 같아야 한다(lib/objects/records.test.ts 가 대조한다).
// 계획: mydocs/plans/2026-11-27-ontology-phase1.md §2-3 · §2-4 · §5

/** Proposal.status */
export const PROPOSAL_STATUSES = ["pending", "accepted", "rejected", "auto_applied", "superseded", "stale"] as const
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

/** Proposal.op — 1단계 제안은 만들기 · 고치기만(지우기는 사람이 맞춤 화면 · Action 으로) */
export const PROPOSAL_OPS = ["create", "update"] as const
export type ProposalOp = (typeof PROPOSAL_OPS)[number]

/** ObjectRevision.op */
export const REVISION_OPS = ["create", "update", "delete", "widen", "revert"] as const
export type RevisionOp = (typeof REVISION_OPS)[number]

/** ObjectRevision.authorKind — ai(자동 반영) · human(공통 층에서 사람) · screen(맞춤 화면) · source(이식 스크립트) */
export const AUTHOR_KINDS = ["ai", "human", "screen", "source"] as const
export type AuthorKind = (typeof AUTHOR_KINDS)[number]

/** Evidence.sourceKind — 근거 원천 */
export const EVIDENCE_SOURCE_KINDS = [
  "chat_message",
  "task",
  "weekly_report",
  "file",
  "ip_communication",
  "email",
  "import_row",
] as const
export type EvidenceSourceKind = (typeof EVIDENCE_SOURCE_KINDS)[number]

/** Evidence.quote 최대 길이(결정 기록 Q7) */
export const QUOTE_MAX = 300

/**
 * 공개 범위 토큰(§2-4, 결정 기록 Q4 — 이 여섯 가지로 시작한다). 빈 배열 = 재직 구성원 누구나 · 외부 자료에도 쓴다.
 * room:<id> 의 id 는 ChatRoom.id. DB 는 토큰 모양을 검사하지 않는다(배열 원소 CHECK 를 쓰지 않는다) — 쓰는 코드가 이 함수를 지난다.
 */
export const VISIBILITY_TOKEN = /^(internal|group:(ip|hr|admin)|room:[A-Za-z0-9_-]{1,64})$/
export const isVisibilityToken = (t: string) => VISIBILITY_TOKEN.test(t)

/** 근거 여럿의 공개 범위 합치기 — 모두 만족해야 보므로 합집합이 곧 교집합 조건이다. 정렬 · 중복 제거 */
export function mergeVisibility(...lists: readonly (readonly string[])[]): string[] {
  const out = new Set<string>()
  for (const l of lists)
    for (const t of l) {
      if (!isVisibilityToken(t)) throw new Error(`모르는 공개 범위 토큰: ${t}`)
      out.add(t)
    }
  return [...out].sort()
}

/** 보는 사람 토큰으로 볼 수 있나 — 대상 토큰 ⊆ 보는 사람 토큰 */
export const canSeeTokens = (target: readonly string[], viewer: ReadonlySet<string>) => target.every((t) => viewer.has(t))

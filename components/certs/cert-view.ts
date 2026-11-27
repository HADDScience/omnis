// 인증 탭(아카이브 › 인증)이 서버에서 받아 그리는 모양 — 직렬화할 수 있는 값만.
import type { CertBonusRow, ChecklistItem, EvidenceRef } from "@/lib/certs"
import type { TipsBonus } from "@/lib/grants-tips"
import { CERT_STAGE_LABEL, CERT_STAGES, type CertStage } from "@/lib/grants-labels"

export interface CertView {
  id: string
  name: string
  officialName: string | null
  issuer: string | null
  stage: CertStage
  stageReason: string | null
  /** 접수 마감 ISO */
  deadline: string | null
  owner: { id: string; name: string } | null
  acquiredOn: string | null
  validUntil: string | null
  certNo: string | null
  priority: string | null
  note: string | null
  checklist: ChecklistItem[]
  evidence: EvidenceRef[]
  /** 조사 원문(수집기) — 판정 이유 · 자격조건 · 신청기간 · 걸리는 기간 · 비용 · 유효기간 */
  research: {
    ourStatus: string | null
    reason: string | null
    requirements: string[]
    window: string | null
    timeToIssue: string | null
    cost: string | null
    validity: string | null
    sources: { title: string | null; url: string }[]
  }
  /** 가점 원문(메디바이오 · 중기부) */
  bonusRaw: string | null
  tips: TipsBonus | null
  /** 이 인증을 따면 가점을 받는 접수 중 공고 */
  bonusRows: CertBonusRow[]
  /** 취득 사건 연혁 */
  record: { title: string; startsOn: string | null } | null
}

/** 단계 색 — 국가과제 단계 칩과 같은 결 */
export const CERT_STAGE_CHIP: Record<CertStage, string> = {
  CANDIDATE: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  PREPARING: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  APPLIED: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  REVIEWING: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  HELD: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  RENEWAL_DUE: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  EXPIRED: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  STOPPED: "bg-muted text-muted-foreground",
}

export const CERT_COLUMNS = CERT_STAGES.map((stage) => ({
  stage,
  label: CERT_STAGE_LABEL[stage],
  dot: CERT_STAGE_CHIP[stage],
}))

export type Member = { id: string; name: string }

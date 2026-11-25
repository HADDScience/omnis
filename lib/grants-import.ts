/**
 * 수집기 내보내기(export/v1) → 옴니스 인증 · 과제 결정 행. DB 를 건드리지 않는 변환만 둔다 —
 * scripts/import-grants.ts 가 이것으로 건식 대조와 실제 쓰기를 한다.
 */
import type { CertStatus, GrantStage, Prisma } from "@/generated/prisma/client"

export type CertItem = {
  key: string
  name: string
  held?: boolean | null
  issuer?: string | null
  bonus_medibio?: string | null
  bonus_mss?: string | null
  difficulty?: string | null
  cost?: string | null
  priority?: string | null
  requirement?: string | null
  note?: string | null
  research?: Record<string, unknown> & {
    official_name?: string
    our_status?: string
    bonus_examples?: unknown
  }
}

export type DecisionItem = {
  key: string
  title: string
  stage: string
  stage_reason?: string | null
  status_raw?: string | null
  owners?: { name: string; raw?: string; role?: string | null }[]
  submitted_title?: string | null
  note?: string | null
  notice_links?: unknown[]
}

const STAGES: Record<string, GrantStage> = {
  검토: "REVIEW",
  준비: "PREPARING",
  제출: "SUBMITTED",
  선정: "SELECTED",
  미선정: "REJECTED",
  불참: "DROPPED",
}

/** 보유 → HELD, 조사에서 미충족 → NOT_ELIGIBLE, 나머지(충족 · 확인 필요) → 취득 후보 */
export function certStatus(item: CertItem): CertStatus {
  const our = item.research?.our_status
  if (item.held || our === "보유") return "HELD"
  if (our === "미충족") return "NOT_ELIGIBLE"
  return "CANDIDATE"
}

export function grantStage(label: string): GrantStage {
  const s = STAGES[label]
  if (!s) throw new Error(`알 수 없는 단계: ${label}`)
  return s
}

export function certRow(item: CertItem, researchedAt: Date | null) {
  const examples = item.research?.bonus_examples
  return {
    externalKey: item.key,
    name: item.name,
    officialName: item.research?.official_name ?? null,
    issuer: item.issuer || null,
    status: certStatus(item),
    priority: item.priority || null,
    difficulty: item.difficulty || null,
    bonus: <Prisma.InputJsonObject>{
      medibio: item.bonus_medibio || null,
      mss: item.bonus_mss || null,
      examples: examples ?? null,
    },
    research: item.research
      ? ({
          ...item.research,
          notionRequirement: item.requirement ?? null,
          notionCost: item.cost ?? null,
        } as Prisma.InputJsonObject)
      : undefined,
    researchedAt: item.research ? researchedAt : null,
    note: item.note || null,
  }
}

export function decisionRow(item: DecisionItem) {
  return {
    externalKey: item.key,
    title: item.title,
    stage: grantStage(item.stage),
    stageReason: item.stage_reason ?? null,
    statusRaw: item.status_raw ?? null,
    submittedTitle: item.submitted_title ?? null,
    note: item.note ?? null,
    noticeLinks: item.notice_links?.length
      ? (item.notice_links as Prisma.InputJsonArray)
      : undefined,
  }
}

/** 보유 인증을 연혁 MILESTONE 제목에 잇는다 — 인증 이름의 핵심 낱말(「인증·확인」 을 뺀 것)이 제목에 하나만 있으면 */
export function matchMilestone(
  certName: string,
  records: { id: string; title: string }[]
): string | null {
  const core = certName.replace(/\s|인증|확인|\(.*?\)/g, "")
  if (core.length < 2) return null
  let hits = records.filter((r) => r.title.replace(/\s/g, "").includes(core))
  // 「벤처기업 … 선정」 처럼 같은 낱말이 든 다른 연혁이 있으면 「인증」 이 든 줄만 본다
  if (hits.length > 1) hits = hits.filter((r) => /인증|인정|확인/.test(r.title))
  return hits.length === 1 ? hits[0].id : null
}

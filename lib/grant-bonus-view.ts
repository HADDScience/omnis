// 공고 가점 표 — 서버에서 우리 인증을 읽어 맞춘다. 화면(국가과제 공고 · 우리 결정 펼침)과 도구(grant_bonus_match)가 같이 쓴다.
import { prisma } from "@/lib/db"
import {
  matchBonus,
  pointsLabel,
  readableQuote,
  readableSource,
  readBonusCap,
  readBonusItems,
  type BonusMatch,
  type BonusTotal,
  type OurCert,
  type OurState,
} from "@/lib/grant-bonus"

export const loadOurCerts = (): Promise<OurCert[]> =>
  prisma.companyCertification.findMany({
    select: { id: true, name: true, officialName: true, status: true, validUntil: true },
  })

/** 표를 만드는 데 필요한 공고 칸 */
export const BONUS_NOTICE_SELECT = {
  id: true,
  externalKey: true,
  title: true,
  deadlineAt: true,
  bonusStatus: true,
  bonusItems: true,
  bonusCap: true,
} as const

export interface BonusNotice {
  title: string
  deadlineAt: Date | null
  bonusStatus: string | null
  bonusItems: unknown
  bonusCap: unknown
}

/** 기준일 — 공고 마감(그날 유효해야 인정), 없으면 오늘 */
const refOf = (n: Pick<BonusNotice, "deadlineAt">) => n.deadlineAt ?? new Date()

/** 뽑은 항목이 있으면 표, 아니면 null */
export function bonusMatchOf(n: BonusNotice, certs: OurCert[]): BonusMatch | null {
  if (n.bonusStatus !== "ok") return null
  const items = readBonusItems(n.bonusItems)
  if (!items.length) return null
  return matchBonus(items, readBonusCap(n.bonusCap), certs, refOf(n))
}

/** 화면에 넘기는 모양(직렬화) */
export interface BonusView {
  rows: {
    label: string
    pointsLabel: string
    condition: string | null
    quote: string
    source: string | null
    state: OurState
    cert: string | null
    note: string | null
    counted: boolean
  }[]
  /** 단위별 합계 — 점이 먼저, 단위가 다른 항목은 섞어 더하지 않는다 */
  totals: BonusTotal[]
  capText: string | null
  unknownPoints: boolean
  /** 결정 펼침에서 이어진 공고가 결정 이름과 다를 때 그 공고 이름 */
  noticeTitle: string | null
}

export function bonusView(m: BonusMatch | null, noticeTitle: string | null = null): BonusView | null {
  if (!m) return null
  return {
    rows: m.rows.map((r) => ({
      label: r.label,
      pointsLabel: pointsLabel(r),
      condition: r.condition,
      quote: readableQuote(r.quote),
      source: readableSource(r.source),
      state: r.state,
      cert: r.cert,
      note: r.note,
      counted: r.counted,
    })),
    totals: m.totals,
    capText: m.cap?.text ?? null,
    unknownPoints: m.unknownPoints,
    noticeTitle,
  }
}

/**
 * 결정 → 가점을 볼 공고. 결정이 올라온 공고(externalKey)가 먼저, 다음은 같은 공고 · 다른 회차 순서.
 * 뽑은 항목이 있는 첫 공고를 쓴다
 */
export function pickDecisionNotice<N extends BonusNotice & { externalKey: string }>(
  decision: { externalKey: string; noticeLinks: unknown },
  byKey: Map<string, N>
): N | null {
  const links = (Array.isArray(decision.noticeLinks) ? decision.noticeLinks : []) as {
    relation?: string
    export_key?: string
  }[]
  const order = [
    decision.externalKey,
    ...links.filter((l) => l.relation === "same" && l.export_key).map((l) => l.export_key!),
    ...links.filter((l) => l.relation === "other_round" && l.export_key).map((l) => l.export_key!),
  ]
  for (const k of order) {
    const n = byKey.get(k)
    if (n && n.bonusStatus === "ok" && readBonusItems(n.bonusItems).length) return n
  }
  return null
}

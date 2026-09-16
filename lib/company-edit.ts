// 회사 정보 · 연도별 재무 편집의 서버 쪽 — 검사된 입력을 DB 값으로 바꾸고, 관리자인지 본다.
import type { Session } from "next-auth"
import { createHash } from "crypto"
import type { CompanyProfileInput, CompanyRecordInput, CompanyYearInput } from "@/lib/schemas/company"

const day = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null)
const big = (s: string | null) => (s === null ? null : BigInt(s))

export const isAdminSession = (session: Session | null) =>
  !!session?.user?.id && (session.user as { role?: string }).role === "ADMIN"

export function profileData(d: CompanyProfileInput) {
  return { ...d, foundedOn: day(d.foundedOn), asOfDate: day(d.asOfDate) }
}

export function yearData(d: CompanyYearInput) {
  return {
    year: d.year,
    basis: d.basis,
    revenueKrw: big(d.revenueKrw),
    revenueProductKrw: big(d.revenueProductKrw),
    revenueServiceKrw: big(d.revenueServiceKrw),
    costOfSalesKrw: big(d.costOfSalesKrw),
    netIncomeKrw: big(d.netIncomeKrw),
    assetsKrw: big(d.assetsKrw),
    liabilitiesKrw: big(d.liabilitiesKrw),
    equityKrw: big(d.equityKrw),
    headcount: d.headcount,
    accountLabel: d.accountLabel,
    note: d.note,
    asOfDate: day(d.asOfDate),
  }
}

export const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === "P2002"

/** 두 값이 같은지 — Date · BigInt · null 을 글자로 맞춰 비교한다 (활동 기록에 바뀐 칸만 남기려고) */
export function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v === null || v === undefined ? "" : String(v))
  return norm(a) === norm(b)
}

/**
 * 연혁 한 줄의 DB 값.
 *
 * `periodRaw` 를 비워 보내면 날짜로 만들어 넣는다 — 화면은 이 칸을 그대로 보여 주므로
 * 비어 있으면 기간이 사라진 것처럼 보인다.
 */
export function recordData(d: CompanyRecordInput) {
  const period = d.periodRaw ?? periodFromDates(d.startsOn, d.endsOn)
  return {
    kind: d.kind,
    title: d.title,
    organizer: d.organizer,
    startsOn: day(d.startsOn),
    endsOn: day(d.endsOn),
    periodRaw: period,
    status: d.status,
    note: d.note,
    subject: d.subject,
    role: d.role,
    fundingKrw: big(d.fundingKrw),
    ownCashKrw: big(d.ownCashKrw),
    ownInKindKrw: big(d.ownInKindKrw),
    grantNo: d.grantNo,
    prize: d.prize,
    venue: d.venue,
    partner: d.partner,
    category: d.category,
  }
}

function periodFromDates(starts: string | null, ends: string | null): string | null {
  if (!starts) return null
  if (!ends || ends === starts) return starts.replace(/-/g, ".")
  // 같은 해면 뒤쪽은 월·일만 — 「2026.04.28~04.30」
  const tail = starts.slice(0, 4) === ends.slice(0, 4) ? ends.slice(5) : ends
  return `${starts.replace(/-/g, ".")}~${tail.replace(/-/g, ".")}`
}

const normKey = (s: string | null | undefined) =>
  (s ?? "").replace(/[\s()［\[\]（）『』「」·.,\-—~㈜]/g, "").toLowerCase()

/**
 * 이식 멱등 키 — `scripts/import-company-context.ts` 와 **같은 규칙**이어야 한다.
 * 화면에서 만든 줄도 다음 이식 때 같은 사건으로 알아보고 겹치지 않는다.
 */
export function recordDedupeKey(d: {
  kind: string
  title: string
  organizer: string | null
  partner: string | null
  startsOn: string | null
  periodRaw: string | null
}): string {
  return createHash("sha1")
    .update([d.kind, normKey(d.title), normKey(d.partner ?? d.organizer), d.startsOn ?? normKey(d.periodRaw)].join("|"))
    .digest("hex")
}

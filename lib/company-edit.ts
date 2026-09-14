// 회사 정보 · 연도별 재무 편집의 서버 쪽 — 검사된 입력을 DB 값으로 바꾸고, 관리자인지 본다.
import type { Session } from "next-auth"
import type { CompanyProfileInput, CompanyYearInput } from "@/lib/schemas/company"

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

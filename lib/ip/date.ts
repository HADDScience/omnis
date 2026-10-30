/**
 * 날짜는 전부 KST(Asia/Seoul) 기준의 "YYYY-MM-DD" 문자열로만 다룬다.
 * 타임존 변환 오차를 피하려고 UTC 자정으로 파싱해 일수만 계산한다.
 */

const DAY_MS = 86_400_000

/** 오늘 날짜(KST)를 "YYYY-MM-DD" 로 반환 */
export function todayKst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function toUtcMs(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** from → to 경과일. 파싱 불가 시 null */
export function daysBetween(from: string | null, to: string): number | null {
  if (!from) return null
  const a = toUtcMs(from)
  const b = toUtcMs(to)
  if (a === null || b === null) return null
  return Math.round((b - a) / DAY_MS)
}

/** "2026-04-24" → "2026.04.24" */
export function formatDate(ymd: string | null): string {
  if (!ymd) return "—"
  return ymd.replace(/-/g, ".")
}

/** "2026-04-24" → "4월 24일" (타임라인 헤더용) */
export function formatMonthDay(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  return `${Number(m[2])}월 ${Number(m[3])}일`
}

/** 경과일 라벨. null 이면 "기준일 없음" */
export function formatDays(days: number | null): string {
  if (days === null) return "기준일 없음"
  if (days === 0) return "오늘"
  if (days < 0) return `${-days}일 후`
  return `${days}일 경과`
}

/** 정체 심각도 구간 */
export type StaleLevel = "정상" | "주의" | "지연" | "심각"

export function staleLevel(days: number | null): StaleLevel {
  if (days === null) return "주의"
  if (days >= 180) return "심각"
  if (days >= 90) return "지연"
  if (days >= 30) return "주의"
  return "정상"
}

// 인증 탭의 날짜 글 — 접수 마감(시각까지) · 유효기간. 서울 기준
import { seoulMinute, seoulYmd } from "@/lib/grants-labels"

/** 남은 날 — 오늘 0, 지난 날은 음수 */
export function daysLeft(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null
  const day = (d: Date | string) => new Date(`${seoulYmd(d)}T00:00:00+09:00`).getTime()
  return Math.round((day(iso) - day(now)) / 86_400_000)
}

/** 「D-21 · 12-18 16:00」 · 「오늘 16:00 마감」 · 「마감 지남 · 12-18」. 23:59 는 시각을 적지 않는다 */
export function deadlineText(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null
  const left = daysLeft(iso, now)!
  const m = seoulMinute(iso)!
  const time = m.endsWith("23:59") ? "" : ` ${m.slice(11)}`
  const md = m.slice(5, 10)
  if (left < 0) return `마감 지남 · ${md}`
  if (left === 0) return `오늘${time || " 까지"} 마감`
  return `D-${left} · ${md}${time}`
}

/** 「2027-03-01 까지 · 95일」 · 「만료 2026-10-01」 */
export function validText(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null
  const left = daysLeft(iso, now)!
  return left < 0 ? `만료 ${seoulYmd(iso)}` : `${seoulYmd(iso)} 까지 · ${left}일`
}

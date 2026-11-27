// 수집기 govgrants → GrantNotice — 비교 규칙(순수 함수, DB 없음). 시험: lib/govgrants-sync-rules.test.ts
//
// scripts/import-grants.ts 의 공고 부분과 같은 규칙을 따른다.
// - 공고 한 건은 noticeRow(lib/grants-import.ts)로 만든다 — 같은 변환.
// - 새 공고는 만들고, 있던 공고는 **바뀐 칸만** 고친다. 하나도 안 바뀌면 쓰지 않는다(updatedAt 도 그대로).
// - noticeRow 가 undefined 로 둔 칸(근거 · 첨부가 없을 때)은 「그대로 둔다」 다. upsert 의 update 와 같다 — 지우지 않는다.
// - 수집기 밖에서 채우는 칸(가점 bonus* — lib/grant-bonus-extract.ts)은 noticeRow 에 없어 건드리지 않는다.
// - 빠진 공고(removed_run)는 지우지 않는다. 마감이 지나 내보내기에서 빠진 공고를 import-grants 도 지우지 않는다.
import type { noticeRow } from "@/lib/grants-import"

export type NoticeRow = ReturnType<typeof noticeRow>
/** noticeRow 가 채우는 칸 중 비교 · 고치기 대상(externalKey 는 열쇠) */
export const NOTICE_FIELDS = [
  "title", "ministry", "agency", "url", "rcptStartAt", "deadlineAt", "deadlineRaw", "regionClass", "regionDetail",
  "fields", "isRnd", "verdictSole", "verdictCorp", "reasonsSole", "reasonsCorp", "judgedBy", "attachments", "firstSeen", "lastSeen",
] as const satisfies readonly Exclude<keyof NoticeRow, "externalKey">[]
export type NoticeField = (typeof NOTICE_FIELDS)[number]

const sorted = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sorted)
    : v && typeof v === "object" && !(v instanceof Date)
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])]))
      : v

/** 비교용 값 — 날짜는 ISO, 객체는 키 순서를 맞춘다. null 과 빈 값은 그대로 null */
function norm(v: unknown): string {
  if (v === null || v === undefined) return "null"
  if (v instanceof Date) return JSON.stringify(v.toISOString())
  return JSON.stringify(sorted(v))
}

/**
 * 있던 공고(existing)와 새로 만든 행(row)의 바뀐 칸. row 의 값이 undefined 면 비교하지 않는다(그대로 둔다).
 */
export function changedFields(existing: Partial<Record<NoticeField, unknown>>, row: NoticeRow): NoticeField[] {
  const out: NoticeField[] = []
  for (const f of NOTICE_FIELDS) {
    const next = row[f]
    if (next === undefined) continue
    if (norm(existing[f]) !== norm(next)) out.push(f)
  }
  return out
}

type Att = { name: string; url: string; size: number | null } & Record<string, unknown>

/**
 * 첨부 크기는 아는 값을 지키다 — 수집기가 Neon 에 크기를 못 실은 첨부(크기 null)가, 로컬 이식 때 받은 크기를 지우지 않게.
 * 같은 주소의 첨부에서 새 크기가 비었고 예전 크기가 있으면 예전 크기를 쓴다. 이름 · 주소 · 순서는 새 값 그대로
 * (2026-11-27 건식: 이 규칙 없이는 42건이 크기를 잃었다).
 */
export function keepKnownSizes(row: NoticeRow, existingAttachments: unknown): NoticeRow {
  if (!Array.isArray(row.attachments) || !Array.isArray(existingAttachments)) return row
  const known = new Map((existingAttachments as Att[]).filter((a) => a && typeof a.size === "number").map((a) => [a.url, a.size as number]))
  if (known.size === 0) return row
  const next = (row.attachments as unknown as Att[]).map((a) => (a.size == null && known.has(a.url) ? { ...a, size: known.get(a.url)! } : a))
  return { ...row, attachments: next as unknown as NoticeRow["attachments"] }
}

/** 고칠 값 — 바뀐 칸만 */
export function updateData(row: NoticeRow, fields: NoticeField[]): Partial<NoticeRow> {
  return Object.fromEntries(fields.map((f) => [f, row[f]])) as Partial<NoticeRow>
}

/** govgrants.notices.attachment_sizes(jsonb, url → 바이트) → noticeRow 가 받는 Map */
export function sizeMap(v: unknown): Map<string, number> {
  const out = new Map<string, number>()
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
      const num = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN
      if (Number.isFinite(num) && num >= 0) out.set(k, num)
    }
  }
  return out
}

export interface PlanCounts {
  items: number
  new: number
  updated: number
  unchanged: number
  fieldCounts: Partial<Record<NoticeField, number>>
}

/** 한 실행의 계획 — 새 · 고칠(바뀐 칸) · 그대로 */
export function plan(rows: NoticeRow[], existing: Map<string, Partial<Record<NoticeField, unknown>>>) {
  const creates: NoticeRow[] = []
  const updates: { key: string; fields: NoticeField[]; data: Partial<NoticeRow> }[] = []
  const counts: PlanCounts = { items: rows.length, new: 0, updated: 0, unchanged: 0, fieldCounts: {} }
  for (const row of rows) {
    const cur = existing.get(row.externalKey)
    if (!cur) { creates.push(row); counts.new++; continue }
    const r = keepKnownSizes(row, cur.attachments)
    const fields = changedFields(cur, r)
    if (fields.length === 0) { counts.unchanged++; continue }
    updates.push({ key: r.externalKey, fields, data: updateData(r, fields) })
    counts.updated++
    for (const f of fields) counts.fieldCounts[f] = (counts.fieldCounts[f] ?? 0) + 1
  }
  return { creates, updates, counts }
}

/** 실행 상태 중 옮길 것 — 수집기가 성공(일부 출처 실패 포함)으로 끝낸 실행만 */
export const IMPORTABLE_STATUS = ["success", "partial"] as const

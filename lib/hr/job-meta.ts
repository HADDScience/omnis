// 공고별 면접 정보 — 보이는 글 · 정렬 · 충돌 확인 · 도구 글 풀기. prisma 를 들이지 않는다(단위 시험 · 화면이 같이 쓴다).
// 읽기 · 쓰기는 lib/hr/job-meta-server.ts, 칸 규칙은 lib/schemas/hr-job.ts.
import { MODE_LABEL, SlotSchema, type InterviewMode, type InterviewSlot } from "@/lib/schemas/hr-job"

export interface JobMeta {
  jobSlug: string
  slots: InterviewSlot[]
  place: string | null
  mode: InterviewMode | null
  videoUrl: string | null
  memo: string | null
}

export const emptyMeta = (jobSlug: string): JobMeta => ({ jobSlug, slots: [], place: null, mode: null, videoUrl: null, memo: null })

/** DB 의 JSON 칸 → 일시 목록. 모양이 틀린 줄은 버린다 */
export function readSlots(v: unknown): InterviewSlot[] {
  if (!Array.isArray(v)) return []
  return sortSlots(v.flatMap((x) => {
    const r = SlotSchema.safeParse(x)
    return r.success ? [r.data] : []
  }))
}

export const sortSlots = (slots: InterviewSlot[]) => [...slots].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"]
/** "2026-12-01" → "2026-12-01(화)" */
export const dateWithDay = (d: string) => `${d}(${WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()]})`

/** "2026-12-01(화) 11:00 · 10분씩" */
export const slotLabel = (s: InterviewSlot) => `${dateWithDay(s.date)} ${s.time}${s.minutesEach ? ` · ${s.minutesEach}분씩` : ""}`

export const modeLabel = (m: InterviewMode | null) => (m ? MODE_LABEL[m] : null)

/** 비어 있지 않은 칸만 「이름: 값」 — PDF 표지 · 도구 글이 같이 쓴다. 값이 없으면 줄을 뺀다 */
export function metaLines(m: JobMeta | null): { label: string; value: string }[] {
  if (!m) return []
  const out: { label: string; value: string }[] = []
  if (m.slots.length) out.push({ label: "면접 일시", value: m.slots.map(slotLabel).join(", ") })
  if (m.place) out.push({ label: "면접 장소", value: m.place })
  if (m.mode) out.push({ label: "면접 방식", value: m.mode === "VIDEO" && m.videoUrl ? `${MODE_LABEL[m.mode]} · ${m.videoUrl}` : MODE_LABEL[m.mode] })
  return out
}

// ─── 칸 단위 충돌 확인 — 화면은 고치기 전에 본 값(expect)을 붙인다. 없으면(도구) 그대로 덮는다 ───

const norm = (field: string, v: unknown): string => {
  if (field === "slots") return JSON.stringify(readSlots(v).map((s) => [s.date, s.time, s.minutesEach ?? null]))
  return typeof v === "string" ? v.trim() : ""
}

/** expect 와 지금 값이 다른 칸 */
export function staleMetaFields(expect: unknown, current: JobMeta): string[] {
  if (!expect || typeof expect !== "object" || Array.isArray(expect)) return []
  const now: Record<string, unknown> = { slots: current.slots, place: current.place, mode: current.mode, videoUrl: current.videoUrl, memo: current.memo }
  return Object.entries(expect as Record<string, unknown>)
    .filter(([k]) => k in now)
    .filter(([k, seen]) => norm(k, seen) !== norm(k, now[k]))
    .map(([k]) => k)
}

// ─── 도구 글 풀기 — "2026-12-01 11:00" · "2026-12-01 11:00 10분씩" ───

const SLOT_TEXT = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?:\s*(?:[·,/]\s*)?(\d{1,3})\s*분?\s*씩?)?$/

export function parseSlotText(text: string): { slot: InterviewSlot } | { error: string } {
  const m = SLOT_TEXT.exec(text.trim())
  if (!m) return { error: `「${text}」 — 일시는 "2026-12-01 11:00" 또는 "2026-12-01 11:00 10분씩" 으로` }
  const r = SlotSchema.safeParse({ date: m[1], time: `${m[2].padStart(2, "0")}:${m[3]}`, ...(m[4] ? { minutesEach: Number(m[4]) } : {}) })
  return r.success ? { slot: r.data } : { error: `「${text}」 — ${r.error.issues[0]?.message ?? "일시가 올바르지 않습니다"}` }
}

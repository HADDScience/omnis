// 공고 첨부 상태 — 수집기(gov-grants)가 원문에서 확인한 「첨부 있음 · 없음 · 확인 불가」 와 받은 첨부를 읽었는지.
// 순수 함수만(prisma 없음). 들이기는 scripts/import-grant-attachment-status.ts, 화면(공고 첨부 칸 · 가점 표)과 grant_bonus_match 가 같이 쓴다.
// 가점 표가 비었을 때 「가점 항목 없음」 인지 「첨부를 못 읽음」 인지 가르는 데 쓴다.

export type AttStatus = "present" | "none" | "unknown"
export const isAttStatus = (v: unknown): v is AttStatus => v === "present" || v === "none" || v === "unknown"

/** 첨부 하나를 읽지 못한(또는 일부만 읽은) 까닭 */
export type AttReason = "image" | "image_partial" | "partial" | "skipped" | "download_failed" | "robots" | "no_url" | "failed"

export const ATT_REASON_LABEL: Record<AttReason, string> = {
  image: "이미지라 못 읽음",
  image_partial: "이미지라 일부만 읽음",
  partial: "일부만 읽음",
  skipped: "압축·그림 파일이라 안 읽음",
  download_failed: "받지 못함",
  robots: "사이트가 받기를 막음",
  no_url: "받는 주소 없음",
  failed: "읽기 실패",
}

/** 글자를 하나도 얻지 못한 것(일부만 읽은 것은 빼고) */
export const UNREADABLE: readonly AttReason[] = ["image", "skipped", "download_failed", "robots", "no_url", "failed"]

/** 수집기 attachments 행 → 까닭. 다 읽었으면 null */
export function reasonOf(row: {
  download_block: string | null
  extract_status: string | null
  image_only: number | boolean | null
  local_path: string | null
}): AttReason | null {
  const img = !!row.image_only
  if (row.download_block === "robots") return "robots"
  if (row.download_block === "no_url") return "no_url"
  if (row.extract_status === "download_failed" || (!row.local_path && !row.extract_status)) return "download_failed"
  if (row.extract_status === "ok") return null
  if (row.extract_status === "partial") return img ? "image_partial" : "partial"
  if (row.extract_status === "skipped") return "skipped"
  return img ? "image" : "failed"
}

/** GrantNotice.attFiles 에 두는 모양 — 첨부 수와, 다 읽지 못한 첨부만 이름 · 까닭 */
export interface AttFiles {
  total: number
  items: { name: string; reason: AttReason }[]
}

/** 같은 이름(같은 공고가 여러 출처에 올라와 같은 파일)은 한 번만 센다 */
export function summarizeAtt(rows: { name: string; reason: AttReason | null }[]): AttFiles {
  const seen = new Map<string, AttReason | null>()
  for (const r of rows) {
    const prev = seen.get(r.name)
    // 같은 이름이 한 번이라도 읽혔으면 읽은 것으로 본다
    if (prev === undefined || (prev !== null && (r.reason === null || (UNREADABLE.includes(prev) && !UNREADABLE.includes(r.reason)))))
      seen.set(r.name, r.reason)
  }
  return {
    total: seen.size,
    items: [...seen].filter(([, r]) => r !== null).map(([name, reason]) => ({ name, reason: reason! })),
  }
}

export function readAttFiles(v: unknown): AttFiles | null {
  if (!v || typeof v !== "object") return null
  const o = v as Record<string, unknown>
  if (typeof o.total !== "number" || !Array.isArray(o.items)) return null
  return {
    total: o.total,
    items: o.items
      .filter((x) => x && typeof x.name === "string" && typeof x.reason === "string" && x.reason in ATT_REASON_LABEL)
      .map((x) => ({ name: x.name as string, reason: x.reason as AttReason })),
  }
}

/** 화면 · 도구가 받는 모양 */
export interface AttView {
  status: AttStatus | null
  /** 원문을 확인한 날(서울 날짜) */
  checkedOn: string | null
  note: string | null
  total: number
  /** 이름 → 까닭 표시(다 읽은 첨부는 없음) */
  byName: Record<string, string>
  /** 까닭별 수 — 「이미지라 못 읽음 2」 */
  counts: { label: string; count: number; unreadable: boolean }[]
  /** 글자를 하나도 얻지 못한 첨부 수 */
  unreadable: number
}

const seoulDay = (d: Date | string) =>
  new Date(d).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10)

export function attView(n: {
  attStatus: string | null
  attCheckedAt: Date | string | null
  attNote: string | null
  attFiles: unknown
}): AttView | null {
  if (!isAttStatus(n.attStatus)) return null
  const files = readAttFiles(n.attFiles) ?? { total: 0, items: [] }
  const order = Object.keys(ATT_REASON_LABEL) as AttReason[]
  const counts = order
    .map((r) => ({ label: ATT_REASON_LABEL[r], count: files.items.filter((i) => i.reason === r).length, unreadable: UNREADABLE.includes(r) }))
    .filter((c) => c.count > 0)
  return {
    status: n.attStatus,
    checkedOn: n.attCheckedAt ? seoulDay(n.attCheckedAt) : null,
    note: n.attNote,
    total: files.total,
    byName: Object.fromEntries(files.items.map((i) => [i.name, ATT_REASON_LABEL[i.reason]])),
    counts,
    unreadable: files.items.filter((i) => UNREADABLE.includes(i.reason)).length,
  }
}

/** 첨부 상태 한 줄 — 「첨부 없음 · 원문 확인 2026-11-27」 「첨부 12개 · 이미지라 못 읽음 2 · 사이트가 받기를 막음 1」 */
export function attLine(v: AttView | null): string | null {
  if (!v) return null
  const on = v.checkedOn ? ` · 원문 확인 ${v.checkedOn}` : ""
  if (v.status === "none") return `첨부 없음${on}`
  if (v.status === "unknown") return `첨부 확인 불가${v.note ? ` · ${v.note}` : ""}${on}`
  const parts = [`첨부 ${v.total}개`, ...v.counts.map((c) => `${c.label} ${c.count}`)]
  return parts.join(" · ") + on
}

/**
 * 가점 항목이 없을 때 그 까닭 — 뽑지 않았으면 null.
 * 첨부가 없거나(원문 확인), 첨부를 못 읽었거나, 읽었는데 가점이 없거나를 가른다
 */
export function bonusEmptyReason(bonusStatus: string | null, items: number, v: AttView | null): string | null {
  if (items > 0 || (bonusStatus !== "ok" && bonusStatus !== "no_text")) return null
  if (v?.status === "none") return `가점 항목 없음 · 첨부 없음${v.checkedOn ? `(원문 확인 ${v.checkedOn})` : ""} · 본문만 봄`
  if (v?.status === "unknown") return "가점 항목 없음 · 첨부 확인 불가"
  if (v && v.unreadable > 0) return `가점 항목 없음 · 첨부 ${v.total}개 중 ${v.unreadable}개를 읽지 못함`
  return "가점 항목 없음"
}

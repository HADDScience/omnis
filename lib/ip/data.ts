import type {
  ActionItem,
  Communication,
  Patent,
  Priority,
  StaleItem,
  Trademark,
} from "@/lib/ip/types"
import { daysBetween } from "@/lib/ip/date"

/**
 * 데이터는 DataProvider(Supabase) 에서 오고, 여기에는 순수 계산만 둔다.
 * 예전에는 seed.json 을 직접 import 했지만 이제 인자로 받는다.
 */

export function trademarkLabel(t: Trademark): string {
  return t.nameKo ? `${t.name} (${t.nameKo})` : t.name
}

/** 진행 중인데 마지막 진행일로부터 오래 지난 건 (경과일 내림차순) */
export function staleItems(
  trademarks: Trademark[],
  patents: Patent[],
  openTrademarkStatuses: Set<string>,
  openPatentStatuses: Set<string>,
  today: string
): StaleItem[] {
  const fromTrademarks: StaleItem[] = trademarks
    .filter((t) => openTrademarkStatuses.has(t.status))
    .map((t) => ({
      kind: "상표" as const,
      id: t.id,
      label: trademarkLabel(t),
      status: t.status,
      date: t.date,
      days: daysBetween(t.date, today),
    }))

  const fromPatents: StaleItem[] = patents
    .filter((p) => openPatentStatuses.has(p.status))
    .map((p) => ({
      kind: "특허" as const,
      id: p.id,
      label: p.title,
      status: p.status,
      date: p.date,
      days: daysBetween(p.date, today),
    }))

  return [...fromTrademarks, ...fromPatents].sort(
    (a, b) => (b.days ?? -1) - (a.days ?? -1)
  )
}

/** 상태별 건수 — 주어진 순서를 유지하고 없는 상태는 0으로 채운다 */
export function countByStatus<T extends { status: string }>(
  rows: T[],
  order: readonly string[]
): { status: string; count: number }[] {
  const map = new Map<string, number>(order.map((s) => [s, 0]))
  for (const row of rows) {
    map.set(row.status, (map.get(row.status) ?? 0) + 1)
  }
  return [...map.entries()].map(([status, count]) => ({ status, count }))
}

const PRIORITY_RANK: Record<Priority, number> = { 높음: 0, 보통: 1, 낮음: 2 }

export function sortedActions(items: ActionItem[]): ActionItem[] {
  return [...items].sort((a, b) => {
    const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    if (byPriority !== 0) return byPriority
    return a.id.localeCompare(b.id)
  })
}

// ---------------------------------------------------------------------------
// 필터 옵션
// ---------------------------------------------------------------------------

export function trademarkClassOptions(trademarks: Trademark[]): string[] {
  const set = new Set<string>()
  for (const t of trademarks) for (const c of t.classes) set.add(c)
  return [...set].sort((a, b) => a.localeCompare(b, "ko"))
}

export function trademarkHolderOptions(trademarks: Trademark[]): string[] {
  const set = new Set<string>()
  for (const t of trademarks) if (t.holder) set.add(t.holder)
  return [...set].sort((a, b) => a.localeCompare(b, "ko"))
}

export function patentApplicantOptions(patents: Patent[]): string[] {
  const set = new Set<string>()
  for (const p of patents) if (p.applicant) set.add(p.applicant)
  return [...set].sort((a, b) => a.localeCompare(b, "ko"))
}

export function communicationPersonOptions(
  communications: Communication[]
): string[] {
  const set = new Set<string>()
  for (const c of communications) {
    set.add(c.from)
    set.add(c.to)
  }
  return [...set].sort((a, b) => a.localeCompare(b, "ko"))
}

/** Gmail 원문 딥링크. 스레드 ID 가 있을 때만. */
export function gmailLink(threadId: string | null): string | null {
  return threadId ? `https://mail.google.com/mail/u/0/#all/${threadId}` : null
}

/** 커뮤니케이션에 연결된 상표/특허 라벨 */
export function linkLabels(
  c: Communication,
  trademarks: Trademark[],
  patents: Patent[]
): { id: string; label: string; kind: "trademark" | "patent" }[] {
  return c.links.map((l) => {
    if (l.kind === "trademark") {
      const t = trademarks.find((x) => x.id === l.id)
      return {
        id: l.id,
        kind: l.kind,
        label: t ? trademarkLabel(t) : l.id,
      }
    }
    const p = patents.find((x) => x.id === l.id)
    return { id: l.id, kind: l.kind, label: p ? p.title : l.id }
  })
}

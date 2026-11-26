// 탭 이동이 멈췄을 때 푸는 규칙(2026-11-26) — 화면(components/layout/floating-nav.tsx)과 시험이 같이 쓴다.
// 근거: ~/work/omnis-reports/nav-stuck-offline-261125.md
//   RSC 요청이 실패하면 Next 는 문서 이동(location.assign)으로 바꾸고 라우터를 페이지가 떠날 때까지 멈춰 둔다.
//   그 문서 이동이 끝나지 않으면(폰에서 와이파이 → 셀룰러) 탭바 표시만 바뀌고 화면은 그대로 남는다.

/** 누른 탭 표시를 이만큼 기다린 뒤 되돌리고 「연결이 느립니다」 를 보인다 */
export const PENDING_HIGHLIGHT_MS = 8_000
/** 누른 뒤 이만큼 주소가 안 바뀌면 그 화면을 새로 연다(한 번만) */
export const STUCK_RESCUE_MS = 10_000
/** 같은 주소를 이 시간 안에 다시 새로 열지 않는다 — 새로고침이 되풀이되지 않게 */
export const RESCUE_GUARD_MS = 60_000

export const RESCUE_KEY = "omnis:nav-rescue"
export const ERROR_QUEUE_KEY = "omnis:error-queue"
export const ERROR_QUEUE_MAX = 20

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">

/**
 * 멈춘 이동을 새로 열지 — 오프라인이면 기다리고(online 때 다시 묻는다), 같은 주소를 1분 안에 이미 새로 열었으면 하지 않는다.
 * 지금 주소와 같으면 reload, 아니면 assign.
 */
export function rescueAction(opts: {
  target: string
  current: string
  online: boolean
  now: number
  store: KV | null
}): "assign" | "reload" | null {
  const { target, current, online, now, store } = opts
  if (!online) return null
  let last: { href?: string; at?: number } | null = null
  try {
    last = JSON.parse(store?.getItem(RESCUE_KEY) ?? "null")
  } catch {
    last = null
  }
  if (last?.href === target && typeof last.at === "number" && now - last.at < RESCUE_GUARD_MS)
    return null
  try {
    store?.setItem(RESCUE_KEY, JSON.stringify({ href: target, at: now }))
  } catch {
    // 저장을 못 하면(사생활 보호 모드) 한 번 새로 여는 것은 그대로 한다
  }
  return target === current ? "reload" : "assign"
}

/** 아카이브처럼 JS 조각을 못 받아 터진 화면 — reset() 으로는 그 조각을 다시 받지 않는다 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const e = error as { name?: unknown; message?: unknown }
  return (
    e.name === "ChunkLoadError" ||
    (typeof e.message === "string" &&
      /Loading (CSS )?chunk [\w/.-]+ failed|ChunkLoadError|Failed to load chunk/i.test(e.message))
  )
}

/** Next 가 RSC 요청 실패 때 남기는 console.error — 「Failed to fetch RSC payload for … Falling back to browser navigation.」 */
export function rscFailureMessage(args: unknown[]): string | null {
  const first = args[0]
  if (typeof first !== "string" || !first.startsWith("Failed to fetch RSC payload")) return null
  return first.slice(0, 500)
}

export type QueuedReport = Record<string, unknown> & { message: string; at: number }

/** 오프라인이라 못 보낸 보고를 쌓는다 — 오래된 것부터 버려 ERROR_QUEUE_MAX 개까지 */
export function enqueueReport(store: KV | null, report: QueuedReport): void {
  if (!store) return
  try {
    const list = readQueue(store)
    list.push(report)
    store.setItem(ERROR_QUEUE_KEY, JSON.stringify(list.slice(-ERROR_QUEUE_MAX)))
  } catch {
    // 못 쌓으면 버린다
  }
}

/** 쌓인 보고를 꺼내고 비운다 */
export function drainQueue(store: KV | null): QueuedReport[] {
  if (!store) return []
  const list = readQueue(store)
  try {
    store.removeItem(ERROR_QUEUE_KEY)
  } catch {
    // 지우지 못해도 보낸 것은 보낸 것이다
  }
  return list
}

function readQueue(store: KV): QueuedReport[] {
  try {
    const v = JSON.parse(store.getItem(ERROR_QUEUE_KEY) ?? "[]")
    return Array.isArray(v) ? (v as QueuedReport[]) : []
  } catch {
    return []
  }
}

// 사진 뷰어의 계산 — 화면과 시험이 같이 쓴다. 손가락 처리 · 그리기는 components/photo-viewer/photo-viewer.tsx
import { safeInlineType } from "@/lib/file-serving"
import { isLargeUpload } from "@/lib/large-upload/rules"

export interface ViewerPhoto {
  fileId: string
  name: string
  /** 원본 주소(/api/files/{id}/raw) */
  original: string
  /** 그 사진이 붙은 글 — 없으면 「글로 이동」 · 삭제 · 공유를 그리지 않는다 */
  messageId?: string
  authorName?: string
  createdAt?: string
  /** 내 글이라 지울 수 있다 */
  canDelete?: boolean
}

export const MIN_SCALE = 1
export const MAX_SCALE = 4
/** 두 번 탭하면 이만큼 — 다시 두 번 탭하면 1 로 */
export const DOUBLE_TAP_SCALE = 2.5
export const DOUBLE_TAP_MS = 300

export const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

/** 확대한 사진을 끌 때 — 화면 밖으로 빈 곳이 보이지 않게 이동을 묶는다 */
export function clampPan(scale: number, x: number, y: number, view: { w: number; h: number }, img: { w: number; h: number }) {
  const maxX = Math.max(0, (img.w * scale - view.w) / 2)
  const maxY = Math.max(0, (img.h * scale - view.h) / 2)
  return { x: Math.min(maxX, Math.max(-maxX, x)) || 0, y: Math.min(maxY, Math.max(-maxY, y)) || 0 }
}

/**
 * 확대하지 않은 상태에서 손가락을 뗐을 때.
 * 옆으로 화면 폭의 1/4(또는 빠르게)면 넘기고, 아래로 120px(또는 빠르게)면 닫는다. 위로는 아무것도 하지 않는다.
 */
export function releaseOutcome(input: { dx: number; dy: number; ms: number; width: number; count: number; index: number }): "next" | "prev" | "close" | "stay" {
  const { dx, dy, ms, width, count, index } = input
  const vx = Math.abs(dx) / Math.max(ms, 1)
  const vy = dy / Math.max(ms, 1)
  if (Math.abs(dx) > Math.abs(dy)) {
    const far = Math.abs(dx) > width / 4 || (vx > 0.5 && Math.abs(dx) > 30)
    if (!far) return "stay"
    if (dx < 0 && index < count - 1) return "next"
    if (dx > 0 && index > 0) return "prev"
    return "stay"
  }
  if (dy > 120 || (vy > 0.6 && dy > 40)) return "close"
  return "stay"
}

/** 끄는 동안 정할 방향 — 처음 10px 에서 굳힌다 */
export function dragAxis(dx: number, dy: number): "x" | "y" | null {
  if (Math.hypot(dx, dy) < 10) return null
  return Math.abs(dx) >= Math.abs(dy) ? "x" : "y"
}

/** 「2장 중 1번」 */
export const positionLabel = (index: number, count: number) => `${count}장 중 ${index + 1}번`

/** 「2026. 11. 5. 20:00」 — 서울 시각 */
export function viewerTime(iso: string): string {
  const d = new Date(iso)
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  )
  return `${p.year}. ${p.month}. ${p.day}. ${p.hour}:${p.minute}`
}

/** 말풍선이 미리보기로 그리는 사진만 뷰어에 — message-list 의 MessageFiles 와 같은 규칙 */
export function isViewerImage(f: { mimeType: string; size: number; name?: string }): boolean {
  return !!safeInlineType(f.mimeType, f.name)?.startsWith("image/") && !isLargeUpload(f.size)
}

/** 주소의 ?photo= — 새로고침해도 같은 사진으로 다시 연다 */
export const PHOTO_PARAM = "photo"

export function withPhotoParam(href: string, fileId: string | null): string {
  const url = new URL(href)
  if (fileId) url.searchParams.set(PHOTO_PARAM, fileId)
  else url.searchParams.delete(PHOTO_PARAM)
  return `${url.pathname}${url.search}${url.hash}`
}

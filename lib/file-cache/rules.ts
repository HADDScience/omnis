// 채팅 파일 카드의 받기 · 열기 규칙 — 화면이 쓰는 순수 함수. 실제 받기 · 기기 저장은 client.ts
//
// 카톡처럼: 카드를 누르면 바로 열지 않고 카드 안에서 받는다(진행률 · 취소) → 받은 뒤 다시 누르면 연다.
// 받은 파일은 기기(Cache Storage)에 두어 같은 파일을 다시 받지 않는다. 한도를 넘으면 오래 안 연 것부터 지운다.

/** 기기에 두는 받은 파일 합계 상한 */
export const FILE_CACHE_LIMIT = 300 * 1024 * 1024

/** 받은 뒤 바로 열 수 있게 메모리에 미리 올려 두는 크기 상한 — 폰의 공유 시트는 누른 그 동작 안에서만 열린다 */
export const PRELOAD_MAX = 60 * 1024 * 1024

/** PDF 첫 장 미리보기를 그릴 원본 상한 — 더 크면 형식 아이콘으로 둔다 */
export const PDF_THUMB_MAX = 40 * 1024 * 1024

export interface CacheEntry {
  id: string
  size: number
  /** 마지막으로 받거나 연 때(ms) */
  at: number
}

/**
 * 새 파일(size)을 넣을 자리 — 지울 id 목록(오래 안 연 것부터). 한도보다 큰 파일은 넣지 않는다(null).
 * 이미 있는 같은 id 는 바꿔 넣으므로 합계에서 뺀다
 */
export function planEviction(entries: CacheEntry[], incoming: { id: string; size: number }, limit = FILE_CACHE_LIMIT): string[] | null {
  if (incoming.size > limit) return null
  const others = entries.filter((e) => e.id !== incoming.id)
  let used = others.reduce((s, e) => s + e.size, 0)
  const out: string[] = []
  for (const e of [...others].sort((a, b) => a.at - b.at)) {
    if (used + incoming.size <= limit) break
    out.push(e.id)
    used -= e.size
  }
  return out
}

export const fileSizeLabel = (size: number) =>
  size < 1024 ? `${size}B` : size < 1048576 ? `${Math.round(size / 1024)}KB` : `${(size / 1048576).toFixed(1)}MB`

/** 0~1. 전체를 모르면 0 */
export function progressRatio(bytes: number, total: number): number {
  if (!(total > 0)) return 0
  return Math.min(1, Math.max(0, bytes / total))
}

/** 「37% · 1.9MB / 5.1MB」 */
export function progressLabel(bytes: number, total: number): string {
  if (!(total > 0)) return `${fileSizeLabel(bytes)} 받는 중`
  return `${Math.round(progressRatio(bytes, total) * 100)}% · ${fileSizeLabel(bytes)} / ${fileSizeLabel(total)}`
}

/** 보내는 카드 — 「업로드 중 · 3.0 / 28.8MB」(카톡과 같은 꼴). 두 숫자는 큰 쪽의 단위로 맞춘다 */
export function uploadLabel(loaded: number, total: number): string {
  const t = Math.max(total, loaded)
  const [unit, div] = t >= 1048576 ? ["MB", 1048576] : ["KB", 1024]
  const n = (v: number) => (unit === "MB" ? (v / div).toFixed(1) : String(Math.round(v / div)))
  return `업로드 중 · ${n(Math.min(loaded, t))} / ${n(t)}${unit}`
}

export type OpenWay = "share" | "tab" | "save"

/**
 * 받은 파일을 어떻게 열까.
 * - 폰(손가락)이고 파일 공유가 되면 공유 시트 — iOS 는 거기서 미리보기 · 「파일에 저장」 을 고른다
 * - 그 자리에서 열어도 안전한 형식(PDF · 사진 · 영상 · 글)은 새 탭
 * - 나머지(zip · hwp · pptx …)는 내려받기(저장)
 * inlineType 은 lib/file-serving 의 safeInlineType 결과 — HTML · SVG 는 null 이라 새 탭으로 열지 않는다(우리 주소에서 스크립트가 돈다)
 */
export function openWay(o: { touch: boolean; canShareFile: boolean; inlineType: string | null }): OpenWay {
  if (o.touch && o.canShareFile) return "share"
  if (o.inlineType) return "tab"
  return "save"
}

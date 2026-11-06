// 채팅 사진 미리보기(WebP) — 화면과 서버가 같이 쓰는 규칙. 서버 전용 모듈을 들이지 않는다.
// 미리보기는 /api/files/{id}/thumb?w=… 가 처음 요청 때 만들어 NAS 에 두고, 원본은 그대로 /raw 로 연다.
import { apiUrl } from "@/lib/base-path"
import { safeInlineType } from "@/lib/file-serving"

/** 미리보기 폭 단계(px). 요청 폭은 이 중 같거나 큰 단계로 올린다 — 캐시가 파일당 네 벌을 넘지 않는다 */
export const THUMB_WIDTHS = [120, 240, 480, 960] as const
export type ThumbWidth = (typeof THUMB_WIDTHS)[number]

/** 미리보기를 만들 때 읽는 원본 상한. raw 의 ?w= 와 같은 20MB(lib/agent/attachments 의 ATTACH_READ_MAX_BYTES) */
export const THUMB_MAX_INPUT_BYTES = 20 * 1024 * 1024

export function thumbWidth(requested: number): ThumbWidth {
  return THUMB_WIDTHS.find((w) => w >= requested) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1]
}

/**
 * 이 파일의 미리보기를 어떻게 줄까.
 * - webp: PNG · JPEG · WebP 를 줄여 WebP 로
 * - original: GIF(움직임을 지킨다) · 너무 큰 사진 → 원본(/raw)으로 보낸다
 * - none: 그 자리에서 열 수 없는 형식(SVG · HEIC 등) — 미리보기가 없다. 화면은 파일 카드로 그린다
 */
export function thumbPlan(file: { mimeType: string; name: string; size: number }): "webp" | "original" | "none" {
  const type = safeInlineType(file.mimeType, file.name)
  if (type === "image/gif") return "original"
  if (type !== "image/png" && type !== "image/jpeg" && type !== "image/webp") return "none"
  return file.size > THUMB_MAX_INPUT_BYTES ? "original" : "webp"
}

/** 브라우저가 WebP 를 받겠다고 했는가. 「*\/*」 만으로는 믿지 않는다(WebP 를 못 그리는 옛 사파리도 보낸다) */
export function acceptsWebp(accept: string | null | undefined): boolean {
  return /(^|,)\s*image\/webp\s*(;|,|$)/i.test(accept ?? "") && !/image\/webp\s*;\s*q=0(\.0*)?\s*(,|$)/i.test(accept ?? "")
}

export function thumbUrl(fileId: string, width: number): string {
  return apiUrl(`/api/files/${fileId}/thumb?w=${thumbWidth(width)}`)
}

/** srcset — 그릴 폭(css px)의 1배 · 2배를 덮는 단계만 */
export function thumbSrcSet(fileId: string, cssWidth: number): string {
  const top = thumbWidth(cssWidth * 2)
  return THUMB_WIDTHS.filter((w) => w <= top && w >= Math.min(thumbWidth(cssWidth), top))
    .map((w) => `${thumbUrl(fileId, w)} ${w}w`)
    .join(", ")
}

/** NAS 의 캐시 자리 — 첨부 폴더(SYNOLOGY_WEBDAV_BASE_PATH) 안 _thumbs/. 원본과 같은 곳이라 같은 문으로만 나간다 */
export function thumbCacheKey(fileId: string, width: ThumbWidth): string {
  return `_thumbs/${fileId}-w${width}.webp`
}

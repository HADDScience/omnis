// 지식재산권 건의 이미지 — 규칙만(순수 모듈, prisma 없음). 화면 · API · MCP 가 같은 답을 쓴다.
// 저장은 ip.case_images(prisma/migrations/20261111150000_ip_case_images), 실물은 기존 첨부(File · NAS/R2).
// 시험: lib/ip-images.test.ts

export type ImageKind = "trademark" | "patent"

export interface CaseImage {
  id: string
  entityKind: ImageKind
  entityId: string
  fileId: string
  /** 원본 파일 이름 */
  name: string
  mimeType: string
  /** 「10/29 변리사 송부 시안」 같은 한 줄 */
  memo: string
  /** 'YYYY-MM-DD' — 시안을 만든 날 · 보낸 날. 모르면 null */
  date: string | null
  isPrimary: boolean
  createdAt: string
}

export const IMAGE_MEMO_MAX = 200
/** 한 건에 거는 이미지 수 — 시안이 많아도 갤러리 · 상세가 무거워지지 않게 */
export const IMAGES_PER_CASE_MAX = 30

/**
 * 이미지로 받는 형식 — 미리보기(/thumb, lib/thumb.ts)가 그릴 수 있는 것만. SVG 는 스크립트를 품을 수 있어
 * 첨부가 inline 으로 내보내지 않고, HEIC 는 미리보기를 못 만든다 — 둘 다 PNG · JPG 로 바꿔 올리게 한다
 */
export const IMAGE_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const

export function isImageMime(mime: string | null | undefined): boolean {
  return !!mime && (IMAGE_MIME as readonly string[]).includes(mime.toLowerCase())
}

const YMD = /^\d{4}-\d{2}-\d{2}$/

export function isYmd(v: string): boolean {
  if (!YMD.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

export interface ImageInput {
  memo?: unknown
  date?: unknown
  isPrimary?: unknown
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string }

/** 메모 · 날짜 · 대표 여부 검사. 빈 날짜("")는 지운다는 뜻(null), 안 보낸 칸은 그대로 둔다(undefined) */
export function checkImageInput(input: ImageInput): Checked<{ memo?: string; date?: string | null; isPrimary?: boolean }> {
  const out: { memo?: string; date?: string | null; isPrimary?: boolean } = {}
  if (input.memo !== undefined && input.memo !== null) {
    if (typeof input.memo !== "string") return { ok: false, error: "메모는 글자여야 합니다" }
    const memo = input.memo.replace(/\s+/g, " ").trim()
    if (memo.length > IMAGE_MEMO_MAX) return { ok: false, error: `메모는 ${IMAGE_MEMO_MAX}자까지입니다` }
    out.memo = memo
  }
  if (input.date !== undefined) {
    if (input.date === null || input.date === "") out.date = null
    else if (typeof input.date !== "string" || !isYmd(input.date)) return { ok: false, error: "날짜는 YYYY-MM-DD 로 적어 주세요" }
    else out.date = input.date
  }
  if (input.isPrimary !== undefined) {
    if (typeof input.isPrimary !== "boolean") return { ok: false, error: "대표 여부는 true · false 입니다" }
    out.isPrimary = input.isPrimary
  }
  return { ok: true, value: out }
}

export const imageCaseKey = (kind: ImageKind, id: string) => `${kind}:${id}`

/** 건별로 묶는다. 대표가 맨 앞, 나머지는 날짜 → 올린 시각 순(최근이 앞) */
export function groupImages(images: CaseImage[]): Map<string, CaseImage[]> {
  const map = new Map<string, CaseImage[]>()
  for (const img of images) {
    const k = imageCaseKey(img.entityKind, img.entityId)
    map.set(k, [...(map.get(k) ?? []), img])
  }
  for (const [k, list] of map) map.set(k, sortImages(list))
  return map
}

export function sortImages(list: CaseImage[]): CaseImage[] {
  return [...list].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1
    const da = a.date ?? a.createdAt.slice(0, 10)
    const db = b.date ?? b.createdAt.slice(0, 10)
    return db.localeCompare(da) || b.createdAt.localeCompare(a.createdAt)
  })
}

/**
 * 갤러리 카드에 보일 이미지. 대표로 지정한 것이 먼저고, 없으면 가장 최근 것.
 * 대표를 안 골랐다고 빈 자리를 보이면 이미지를 올린 보람이 없다.
 */
export function coverOf(list: CaseImage[] | undefined): CaseImage | null {
  if (!list || list.length === 0) return null
  return sortImages(list)[0]
}

/** 이미지가 없을 때 자리표시 글자 — 이름의 첫 글자(영문은 대문자). 「(가칭) 아떼셀」 처럼 괄호 머리는 건너뛴다 */
export function placeholderGlyph(name: string): string {
  const cleaned = name.replace(/^\s*[([（【][^)\]）】]*[)\]）】]\s*/, "").trim()
  const ch = [...(cleaned || name.trim())][0] ?? "?"
  return ch.toLocaleUpperCase("ko-KR")
}

// ─── 보기 전환(목록 / 갤러리) ─────────────────────────────────────────

export type RegisterLayout = "list" | "gallery"
export const LAYOUT_STORAGE_KEY = "omnis.ip.register.layout"

export function parseLayout(raw: string | null | undefined): RegisterLayout {
  return raw === "gallery" ? "gallery" : "list"
}

/** 이 기기에 기억한 보기. 저장소를 못 쓰면(사생활 모드 등) 목록 */
export function readLayout(storage: Pick<Storage, "getItem"> | null | undefined): RegisterLayout {
  try {
    return parseLayout(storage?.getItem(LAYOUT_STORAGE_KEY))
  } catch {
    return "list"
  }
}

export function writeLayout(storage: Pick<Storage, "setItem"> | null | undefined, layout: RegisterLayout): void {
  try {
    storage?.setItem(LAYOUT_STORAGE_KEY, layout)
  } catch {
    // 기억 못 해도 지금 화면은 바뀐다
  }
}

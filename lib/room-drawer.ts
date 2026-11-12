/**
 * 방 서랍(사진 · 파일 · 링크 · 참여자)과 「N개 받기」 의 규칙 — 순수 함수만. 시험: room-drawer.test.ts
 * 서버(lib/room-drawer-server.ts · /api/chat/drawer)와 화면(components/messenger/room-drawer.tsx)이 같은 답을 쓴다.
 */

export type DrawerTab = "photos" | "files" | "links" | "members"
export type DrawerPeriod = "week" | "month" | "all"
/** 종류 필터 — 사진 탭은 photo · gif, 파일 탭은 나머지 */
export type DrawerKind = "all" | "photo" | "gif" | "doc" | "sheet" | "slide" | "pdf" | "video" | "audio" | "archive" | "other"

export const DRAWER_TABS: { id: DrawerTab; label: string }[] = [
  { id: "photos", label: "사진" },
  { id: "files", label: "파일" },
  { id: "links", label: "링크" },
  { id: "members", label: "참여자" },
]
export const DRAWER_PERIODS: { id: DrawerPeriod; label: string }[] = [
  { id: "week", label: "이번 주" },
  { id: "month", label: "이번 달" },
  { id: "all", label: "전체" },
]
export const PHOTO_KINDS: { id: DrawerKind; label: string }[] = [
  { id: "all", label: "모두" },
  { id: "photo", label: "사진" },
  { id: "gif", label: "GIF" },
]
export const FILE_KINDS: { id: DrawerKind; label: string }[] = [
  { id: "all", label: "모두" },
  { id: "pdf", label: "PDF" },
  { id: "doc", label: "문서" },
  { id: "sheet", label: "표" },
  { id: "slide", label: "발표" },
  { id: "video", label: "동영상" },
  { id: "audio", label: "음성" },
  { id: "archive", label: "압축" },
  { id: "other", label: "기타" },
]

/** 한 번에 받는 묶음의 상한 — 넘으면 나눠 받기를 권한다(브라우저 메모리 · 폰 저장 공간) */
export const DOWNLOAD_BATCH_BYTES = 1024 ** 3
/** 한 번에 받기로 고를 수 있는 수 — 서명 주소를 한 요청에 만든다 */
export const DOWNLOAD_MAX_FILES = 500

const SEOUL_OFFSET_MS = 9 * 3600_000

/**
 * 기간의 시작(포함) — 서울 기준. 이번 주는 월요일 0시, 이번 달은 1일 0시. 전체는 null.
 * 화면과 서버가 같은 now 를 쓰지 않아도 답이 하루 안에서 같다(서울 날짜로 자른다).
 */
export function periodStart(period: DrawerPeriod, now: Date): Date | null {
  if (period === "all") return null
  const seoul = new Date(now.getTime() + SEOUL_OFFSET_MS)
  const y = seoul.getUTCFullYear()
  const m = seoul.getUTCMonth()
  const d = seoul.getUTCDate()
  if (period === "month") return new Date(Date.UTC(y, m, 1) - SEOUL_OFFSET_MS)
  const dow = (seoul.getUTCDay() + 6) % 7 // 월 0 … 일 6
  return new Date(Date.UTC(y, m, d - dow) - SEOUL_OFFSET_MS)
}

export function isDrawerPeriod(v: unknown): v is DrawerPeriod {
  return v === "week" || v === "month" || v === "all"
}
export function isDrawerKind(v: unknown): v is DrawerKind {
  return typeof v === "string" && [...PHOTO_KINDS, ...FILE_KINDS].some((k) => k.id === v)
}

const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "")

/** 파일 하나의 종류 — 사진 탭(photo · gif)과 파일 탭(나머지)을 가른다 */
export function fileCategory(f: { name: string; mimeType: string }): Exclude<DrawerKind, "all"> {
  const ext = extOf(f.name)
  const mime = f.mimeType.toLowerCase()
  if (mime === "image/gif" || ext === "gif") return "gif"
  if (mime.startsWith("image/") && mime !== "image/svg+xml") return "photo"
  if (mime === "application/pdf" || ext === "pdf") return "pdf"
  if (mime.startsWith("video/") || ["mp4", "mov", "m4v", "webm", "avi", "mkv"].includes(ext)) return "video"
  if (mime.startsWith("audio/") || ["m4a", "mp3", "wav", "aac", "ogg", "flac"].includes(ext)) return "audio"
  if (["xls", "xlsx", "csv", "numbers", "tsv"].includes(ext)) return "sheet"
  if (["ppt", "pptx", "key"].includes(ext)) return "slide"
  if (["doc", "docx", "hwp", "hwpx", "txt", "md", "rtf", "pages", "odt"].includes(ext)) return "doc"
  if (["zip", "7z", "rar", "tar", "gz", "tgz"].includes(ext)) return "archive"
  return "other"
}

export const isPhotoCategory = (c: DrawerKind) => c === "photo" || c === "gif"

/** 이 탭 · 종류 필터에 드는가 */
export function matchesKind(tab: "photos" | "files", kind: DrawerKind, f: { name: string; mimeType: string }): boolean {
  const c = fileCategory(f)
  if (tab === "photos" ? !isPhotoCategory(c) : isPhotoCategory(c)) return false
  return kind === "all" || kind === c
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size}B`
  if (size < 1024 ** 2) return `${Math.round(size / 1024)}KB`
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)}MB`
  return `${(size / 1024 ** 3).toFixed(2)}GB`
}

// ─── zip 안 이름 ───────────────────────────────────────────

/** 파일 이름에 못 쓰는 글자(윈도 · 맥 · zip 경로)를 _ 로, 앞뒤 점 · 공백을 걷는다 */
export function safeName(s: string, fallback = "파일"): string {
  const cleaned = s.replace(/[\u0000-\u001f\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "").trim()
  return (cleaned || fallback).slice(0, 120)
}

/** 서울 날짜 YYYY-MM-DD */
export function seoulDate(iso: string | Date): string {
  const t = new Date(new Date(iso).getTime() + SEOUL_OFFSET_MS)
  return t.toISOString().slice(0, 10)
}

/** zip 이름 · 안 폴더 — 「방이름_YYMM」(받는 날 기준, 서울) */
export function zipFolderName(roomName: string, now: Date): string {
  const d = seoulDate(now)
  return `${safeName(roomName, "채팅")}_${d.slice(2, 4)}${d.slice(5, 7)}`
}

export interface DownloadItem {
  fileId: string
  name: string
  size: number
  mimeType: string
  createdAt: string
  authorName: string
}

/**
 * zip 안 경로 — 「방이름_YYMM/YYYY-MM-DD_보낸사람_원래이름」. 같은 이름이 겹치면 확장자 앞에 (2) · (3).
 * 대소문자만 다른 이름도 겹친 것으로 본다(맥 · 윈도 파일 시스템은 같은 파일로 푼다).
 */
export function zipEntryNames(items: DownloadItem[], roomName: string, now: Date): string[] {
  const folder = zipFolderName(roomName, now)
  const used = new Set<string>()
  return items.map((it) => {
    const base = `${seoulDate(it.createdAt)}_${safeName(it.authorName, "알수없음")}_${safeName(it.name)}`
    const dot = base.lastIndexOf(".")
    const hasExt = dot > base.indexOf("_", 11) && dot > 0 && base.length - dot <= 10
    const stem = hasExt ? base.slice(0, dot) : base
    const ext = hasExt ? base.slice(dot) : ""
    let candidate = base
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`
    used.add(candidate.toLowerCase())
    return `${folder}/${candidate}`
  })
}

/** 고른 순서를 지키며 상한 안으로 나눈다. 한 파일이 상한보다 크면 그 파일 하나가 한 묶음이다 */
export function splitBatches<T extends { size: number }>(items: T[], limit = DOWNLOAD_BATCH_BYTES): T[][] {
  const out: T[][] = []
  let cur: T[] = []
  let sum = 0
  for (const it of items) {
    if (cur.length > 0 && sum + it.size > limit) {
      out.push(cur)
      cur = []
      sum = 0
    }
    cur.push(it)
    sum += it.size
  }
  if (cur.length > 0) out.push(cur)
  return out
}

export const totalBytes = (items: { size: number }[]) => items.reduce((s, it) => s + it.size, 0)

// ─── 카톡 자리표시(원본 없음) ─────────────────────────────────

export interface MissingItem {
  messageId: string
  createdAt: string
  authorName: string
  /** 「사진 3장」 · 「동영상」 · 파일 이름 */
  label: string
  kind: "photo" | "video" | "file"
}

/** 빠진파일.txt 본문 — 받는 사람이 누구에게 무엇을 다시 요청할지 보이게 */
export function missingListText(roomName: string, missing: MissingItem[]): string {
  const lines = [
    `「${roomName}」 에서 받지 못한 첨부 ${missing.length}개`,
    "카카오톡에서 옴니스로 옮길 때 원본을 받지 못해 옴니스에 파일이 없습니다.",
    "카톡 원본이나 보낸 사람에게 요청하세요.",
    "",
    ...missing.map((m) => `${seoulDate(m.createdAt)}\t${m.authorName}\t${m.label}`),
    "",
  ]
  return lines.join("\r\n")
}

// ─── 링크 ─────────────────────────────────────────────────

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi

/** 글 본문의 링크 — 끝의 문장부호 · 닫는 괄호(여는 괄호가 없으면)를 뗀다. 같은 글 안 중복은 한 번 */
export function extractLinks(content: string): string[] {
  const out: string[] = []
  for (const m of content.matchAll(URL_RE)) {
    let url = m[0].replace(/[.,;:!?。、」』）]+$/u, "")
    while (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1)
    try {
      new URL(url)
    } catch {
      continue
    }
    if (!out.includes(url)) out.push(url)
  }
  return out
}

export function linkHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return url
  }
}

// ─── 받는 방법 ────────────────────────────────────────────

/**
 * 폰에서 사진만 고르고 공유 시트에 파일을 넘길 수 있으면 「사진에 저장」(공유 시트), 아니면 zip.
 * 공유 시트로 넘기는 상한은 iOS 가 정하지 않지만 메모리에 올리므로 묶음 상한을 같이 쓴다.
 */
export function downloadMode(input: { touch: boolean; canShareFiles: boolean; items: { name: string; mimeType: string }[] }): "share" | "zip" {
  if (!input.touch || !input.canShareFiles || input.items.length === 0) return "zip"
  return input.items.every((it) => isPhotoCategory(fileCategory(it)) || fileCategory(it) === "video") ? "share" : "zip"
}

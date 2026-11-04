// 큰 첨부의 규칙 — 화면과 서버가 함께 쓰는 순수 함수와 상수. 시험: rules.test.ts
// 설계: mydocs/plans/2026-11-04-large-upload.md
import { ATTACH_MAX_BYTES, MAX_UPLOAD_BYTES } from "@/lib/constants"

const MiB = 1024 * 1024

/** 화면이 새 경로를 쓰는가. 꺼져 있으면 4MB 상한 · 기존 경로 그대로다 */
export const largeUploadClientEnabled = process.env.NEXT_PUBLIC_LARGE_UPLOAD === "1"

/** 브라우저 → 임시 저장소 조각. 줄이면 재개 때 다시 보내는 양이 줄고, 요청 수가 는다 */
export const UPLOAD_PART_BYTES = 16 * MiB
/** 임시 저장소 → NAS 한 단계. 서울 함수 → NAS 16MB 0.74~0.86초(11/4 실측)라 300MB 를 10단계로 나눈다 */
export const COPY_SEGMENT_BYTES = 32 * MiB
/** 임시본 삭제 직전 대조하는 범위 하나의 길이. 되읽기가 NAS 캐시였을 수 있어 한 번 더 본다 */
export const SAMPLE_BYTES = MiB
/** 조각 몇 개마다 진척을 DB 에 적는가. Neon 쓰기를 줄인다 */
export const PROGRESS_EVERY_SEGMENTS = 4
/** 동시에 NAS 로 복사하는 파일 수. 회선이 공용이다 */
export const COPY_CONCURRENCY = 2
/** 같은 조각을 다시 복사해 보는 횟수 */
export const SEGMENT_MISMATCH_LIMIT = 3
/** 업로드 재개 표(서명된 세션)의 수명 */
export const SESSION_TTL_MS = 7 * 86_400_000
/** VERIFIED 뒤 임시본을 지우기까지. 그 전에 시작한 내려받기(함수 최대 300초)가 끊기지 않게 */
export const TEMP_DELETE_DELAY_MS = 15 * 60_000
/** NAS 를 이만큼 못 만나면 FAILED 로 두고 사람을 부른다. 임시본은 지우지 않는다 */
export const WAIT_NAS_LIMIT_MS = 30 * 86_400_000
/** 진척 없는 전송을 크론이 다시 시작하는 기준 */
export const STALE_TRANSFER_MS = 24 * 3_600_000
/** 파일 행이 없는 임시본을 크론이 지우는 기준 */
export const ORPHAN_BLOB_MS = 7 * 86_400_000

export const ATTACH_MAX_MB = Math.floor(ATTACH_MAX_BYTES / MiB)

/** 고른 파일이 받을 수 있는 크기인가 — 꺼져 있으면 지금 상한(4MB) */
export function attachLimitBytes(enabled = largeUploadClientEnabled): number {
  return enabled ? ATTACH_MAX_BYTES : MAX_UPLOAD_BYTES
}

/** 새 경로로 보낼 파일인가. 4MB 이하는 지금 경로를 그대로 쓴다 */
export function isLargeUpload(size: number, enabled = largeUploadClientEnabled): boolean {
  return enabled && size > MAX_UPLOAD_BYTES
}

/** 임시 저장소의 경로. 파일 이름을 넣지 않는다 — 스토어 목록 · 로그에 이름이 남지 않게 */
export function blobPathnameFor(fileId: string): string {
  return `uploads/${fileId}/${fileId}`
}

/** 경로로 쓰이는 값이 아니어도(저장 키의 확장자로 쓰인다) 경로 문자 · 제어 문자는 남기지 않는다 */
export function sanitizeUploadName(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim()
  return clean.slice(-200) || "파일"
}

export function partCount(size: number, partBytes = UPLOAD_PART_BYTES): number {
  return Math.max(1, Math.ceil(size / partBytes))
}

/** n 번째(1부터) 조각의 파일 안 위치 */
export function partRange(partNumber: number, size: number, partBytes = UPLOAD_PART_BYTES): { start: number; end: number } {
  const start = (partNumber - 1) * partBytes
  return { start, end: Math.min(start + partBytes, size) }
}

export function segmentCount(size: number, segmentSize: number): number {
  return Math.max(1, Math.ceil(size / segmentSize))
}

/** i 번째(0부터) 복사 단계의 바이트 범위 */
export function segmentRange(index: number, size: number, segmentSize: number): { start: number; length: number } {
  const start = index * segmentSize
  return { start, length: Math.min(segmentSize, size - start) }
}

/** 삭제 직전에 대조할 범위 — 앞 · 가운데 · 끝. 겹치면 하나로 */
export function sampleRanges(size: number, sampleBytes = SAMPLE_BYTES): { start: number; length: number }[] {
  const length = Math.min(sampleBytes, size)
  const starts = [0, Math.floor((size - length) / 2), size - length]
  return [...new Set(starts)].map((start) => ({ start, length }))
}

/** NAS 를 기다리는 간격: 5분, 15분, 30분, 1시간, 이후 6시간 */
export function nasWaitMs(round: number): number {
  const steps = [5, 15, 30, 60]
  return (steps[round] ?? 360) * 60_000
}

export type NasFailure = "nas_down" | "certificate" | "disk_full"

/** 복사 중 NAS 쪽 실패의 종류. null 이면 NAS 사정으로 보이지 않는 실패다(그대로 던져 단계 재시도에 맡긴다) */
export function classifyNasFailure(error: unknown): NasFailure | null {
  if (!(error instanceof Error)) return null
  if (error.message.includes("인증서 지문")) return "certificate"
  const code = (error as NodeJS.ErrnoException).code ?? ""
  if (["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "ETIMEDOUT", "EPIPE", "EAI_AGAIN"].includes(code)) return "nas_down"
  if (error.message === "socket hang up" || error.message.startsWith("시놀로지 연결이") || error.message.startsWith("시놀로지가")) return "nas_down"
  return null
}

export function isTempReadable(state: string): boolean {
  return state !== "VERIFIED" && state !== "TEMP_DELETED"
}

export type ByteRange = { start: number; end: number }

/**
 * Range 헤더 한 범위. 없거나 못 읽으면 null(전체), 파일 밖이면 "unsatisfiable"(416).
 * 여러 범위는 전체로 답한다 — 브라우저 · 동영상 재생은 한 범위만 묻는다.
 */
export function parseRange(header: string | null | undefined, size: number): ByteRange | null | "unsatisfiable" {
  const m = header?.trim().match(/^bytes=(\d*)-(\d*)$/)
  if (!m || (m[1] === "" && m[2] === "")) return null
  if (m[1] === "") {
    const suffix = Number(m[2])
    if (suffix === 0) return "unsatisfiable"
    return { start: Math.max(size - suffix, 0), end: size - 1 }
  }
  const start = Number(m[1])
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1)
  if (start >= size) return "unsatisfiable"
  if (end < start) return null
  return { start, end }
}

/** 남은 시간 표시. 처음 몇 초의 속도는 믿지 못해 비운다 */
export function remainingLabel(loaded: number, total: number, elapsedMs: number): string | null {
  if (elapsedMs < 3_000 || loaded <= 0) return null
  const left = ((total - loaded) / loaded) * elapsedMs
  if (left < 60_000) return "1분 안쪽"
  return `약 ${Math.ceil(left / 60_000)}분`
}

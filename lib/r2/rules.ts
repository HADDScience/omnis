// R2(S3 호환) 큰 첨부 — 화면과 서버가 함께 쓰는 순수 함수와 상수. 시험: rules.test.ts
// 설계 · 켜는 법: mydocs/manual/r2-upload.md
import { partCount, partRange } from "@/lib/large-upload/rules"

/** 조각 PUT 서명의 수명. 서명을 받은 뒤 이 안에 보내기 시작해야 한다. 끊기면 화면이 다시 받는다 */
export const PART_URL_TTL_SECONDS = 15 * 60
/**
 * 열람 서명의 수명. 영상은 같은 주소로 범위 요청을 이어 가므로 재생 중 만료되면 그 뒤 탐색이 403 이 된다 —
 * 화면이 /raw 를 다시 열면(새로 고침 · 다시 누르기) 새 주소를 받는다. 짧게 두되 30분 영상 한 편은 버티게.
 */
export const GET_URL_TTL_SECONDS = 30 * 60
/** 한 번에 서명해 주는 조각 수. 300MB ÷ 16MiB = 19 라 한 번에 다 받을 수도 있지만, 수명 안에 쓰는 만큼만 준다 */
export const MAX_SIGN_PARTS = 8

export type R2Part = { partNumber: number; etag: string; size: number }

/**
 * 합치기 전에 저장소에 남은 조각이 파일 하나를 빈틈없이 덮는지 본다.
 * R2 는 마지막을 뺀 조각이 모두 같은 크기여야 한다 — 크기까지 맞춰 본다. 문제가 없으면 null.
 */
export function partsProblem(parts: R2Part[], size: number, partBytes: number): string | null {
  const total = partCount(size, partBytes)
  const byNumber = new Map(parts.map((p) => [p.partNumber, p]))
  if (byNumber.size !== parts.length) return "같은 조각이 두 번 있습니다"
  for (const p of parts) if (p.partNumber < 1 || p.partNumber > total) return `파일 밖의 조각(${p.partNumber})이 있습니다`
  for (let n = 1; n <= total; n++) {
    const part = byNumber.get(n)
    if (!part) return `${n}번 조각이 없습니다`
    const { start, end } = partRange(n, size, partBytes)
    if (part.size !== end - start) return `${n}번 조각의 크기가 맞지 않습니다`
  }
  return null
}

/** 아직 안 올라간 조각 번호. 크기가 틀린 조각도 다시 보낸다(같은 번호로 다시 올리면 덮어쓴다) */
export function missingParts(parts: R2Part[], size: number, partBytes: number): number[] {
  const ok = new Set(
    parts
      .filter((p) => {
        if (p.partNumber < 1) return false
        const { start, end } = partRange(p.partNumber, size, partBytes)
        return end > start && p.size === end - start
      })
      .map((p) => p.partNumber),
  )
  return Array.from({ length: partCount(size, partBytes) }, (_, i) => i + 1).filter((n) => !ok.has(n))
}

/** 서명해 줄 조각 번호를 고른다 — 정수 · 범위 안 · 중복 없음 · 최대 MAX_SIGN_PARTS */
export function signablePartNumbers(input: unknown, size: number, partBytes: number): number[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_SIGN_PARTS) return null
  const total = partCount(size, partBytes)
  const out: number[] = []
  for (const n of input) {
    if (!Number.isInteger(n) || n < 1 || n > total || out.includes(n)) return null
    out.push(n)
  }
  return out
}

/** 저장 합계 상한(MB). R2 무료 구간이 10GB-월이라 그 아래에서 멈춘다 — 넘기면 저장 GB-월 $0.015 */
export function r2StorageCapBytes(env: Record<string, string | undefined> = process.env): number {
  return Number(env.R2_STORAGE_CAP_MB || 9_000) * 1024 * 1024
}

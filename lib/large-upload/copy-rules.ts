// 복사의 판단 — 저장소를 인자로 받는 함수. 잘못된 파일이 VERIFIED 가 되거나 원본이 지워지는 일을 여기서 막는다. 시험: copy-rules.test.ts
import { createHash } from "node:crypto"
import type { CopyResult } from "./copy-loop"
import { classifyNasFailure, sampleRanges } from "./rules"

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex")

/** 범위를 다 받지 못했으면 null, 임시본이 없으면 "missing" */
type TempRead = Buffer | "missing" | null

export async function copyOneSegment(
  store: {
    readTemp: () => Promise<TempRead>
    writeNas: (body: Buffer) => Promise<number>
    readNas: () => Promise<Buffer | null>
  },
  previousManifest: string | null,
): Promise<CopyResult> {
  const source = await store.readTemp()
  if (source === "missing") return { kind: "blob_missing" }
  // 임시 저장소의 일시 문제다. 던지면 단계 재시도가 맡는다
  if (!source) throw new Error("임시 저장소가 요청한 범위를 주지 않았습니다")
  const hash = sha256(source)

  try {
    const status = await store.writeNas(source)
    if (status === 507) return { kind: "disk_full" }
    if (status >= 500) return { kind: "nas_down" }
    if (status < 200 || status >= 300) throw new Error(`NAS 쓰기 실패 (HTTP ${status})`)
    const back = await store.readNas()
    if (!back || sha256(back) !== hash) return { kind: "mismatch" }
  } catch (e) {
    const failure = classifyNasFailure(e)
    if (failure) return { kind: failure }
    throw e
  }
  return { kind: "ok", manifest: sha256(`${previousManifest ?? ""}${hash}`) }
}

export type DeleteCheck = { kind: "ok" } | { kind: "retry" } | { kind: "bad"; reason: string }

/** 임시본을 지워도 되는가. 되읽기가 NAS 캐시였을 수 있어 크기와 표본 범위를 임시본과 직접 대조한다 */
export async function verifyBeforeDelete(
  store: {
    statNas: () => Promise<number | null>
    readTemp: (start: number, length: number) => Promise<TempRead>
    readNas: (start: number, length: number) => Promise<Buffer | null>
  },
  size: number,
): Promise<DeleteCheck> {
  try {
    const actual = await store.statNas()
    if (actual !== size) return { kind: "bad", reason: `삭제 전 대조: 크기가 다릅니다 (${actual ?? "없음"} ≠ ${size})` }
    for (const { start, length } of sampleRanges(size)) {
      const [temp, nas] = await Promise.all([store.readTemp(start, length), store.readNas(start, length)])
      if (temp === "missing") return { kind: "bad", reason: "삭제 전 대조: 임시본이 없습니다" }
      if (!temp || !nas || sha256(temp) !== sha256(nas)) return { kind: "bad", reason: `삭제 전 대조: ${start} 범위의 내용이 다릅니다` }
    }
  } catch (e) {
    if (classifyNasFailure(e)) return { kind: "retry" }
    throw e
  }
  return { kind: "ok" }
}

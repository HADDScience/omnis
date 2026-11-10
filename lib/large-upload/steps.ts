// Workflow 단계 — 본문은 ./transfer.ts. "use step" 함수의 인자와 반환값은 Workflow 이벤트 기록에 남는다 — 파일 이름 · 비밀을 넘기지 않는다.
import type { CopyResult } from "./copy-loop"

export async function loadCopyPlan(fileId: string) {
  "use step"
  const { loadCopyPlan } = await import("./transfer")
  return loadCopyPlan(fileId)
}

export async function claimCopySlot(fileId: string) {
  "use step"
  const { claimCopySlot } = await import("./transfer")
  return claimCopySlot(fileId)
}

export async function copySegment(fileId: string, index: number, manifest: string | null): Promise<CopyResult> {
  "use step"
  const { copySegment } = await import("./transfer")
  return copySegment(fileId, index, manifest)
}

export async function recordProgress(fileId: string, segmentsDone: number, manifest: string | null) {
  "use step"
  const { recordProgress } = await import("./transfer")
  return recordProgress(fileId, segmentsDone, manifest)
}

export async function markWaiting(fileId: string, segmentsDone: number, manifest: string | null, reason: string) {
  "use step"
  const { markWaiting } = await import("./transfer")
  return markWaiting(fileId, segmentsDone, manifest, reason)
}

/** NAS 만 찔러 본다 — 기다리는 동안 DB 를 깨우지 않는다 */
export async function probeNas(): Promise<boolean> {
  "use step"
  const { nasReachable } = await import("@/lib/storage")
  return nasReachable()
}

export async function verifyWholeSize(fileId: string) {
  "use step"
  const { verifyWholeSize } = await import("./transfer")
  return verifyWholeSize(fileId)
}

export async function markVerified(fileId: string, segmentsDone: number, manifest: string | null) {
  "use step"
  const { markVerified } = await import("./transfer")
  return markVerified(fileId, segmentsDone, manifest)
}

export async function failTransfer(fileId: string, reason: string) {
  "use step"
  const { failTransfer } = await import("./transfer")
  return failTransfer(fileId, reason)
}

export async function alertStep(fileId: string, reason: string) {
  "use step"
  const { alertTransfer } = await import("./alert")
  return alertTransfer(fileId, reason)
}

export async function deleteTemp(fileId: string) {
  "use step"
  const { deleteTemp } = await import("./transfer")
  return deleteTemp(fileId)
}

// 복사 한 건의 흐름. 단계와 시계를 인자로 받아 Workflow 밖에서 시험한다(copy-loop.test.ts).
// Workflow 문맥에서 돌므로 Node 를 쓰지 않는다.
import { nasWaitMs, PROGRESS_EVERY_SEGMENTS, SEGMENT_MISMATCH_LIMIT, TEMP_DELETE_DELAY_MS, WAIT_NAS_LIMIT_MS } from "./rules"

export type CopyResult =
  | { kind: "ok"; manifest: string }
  | { kind: "mismatch" }
  | { kind: "blob_missing" }
  | { kind: "nas_down" | "certificate" | "disk_full" }

export interface CopyOps {
  now: () => number
  sleep: (ms: number) => Promise<void>
  loadCopyPlan: () => Promise<{ state: string; segments: number; segmentsDone: number; manifestSha256: string | null } | null>
  /** busy: 자리가 없다. stop: 그새 끝났거나 실패로 바뀌었다 */
  claimCopySlot: () => Promise<"ok" | "busy" | "stop">
  copySegment: (index: number, manifest: string | null) => Promise<CopyResult>
  recordProgress: (segmentsDone: number, manifest: string | null) => Promise<void>
  markWaiting: (segmentsDone: number, manifest: string | null, reason: string) => Promise<void>
  probeNas: () => Promise<boolean>
  verifyWholeSize: () => Promise<{ ok: boolean; expected: number; actual: number | null }>
  markVerified: (segmentsDone: number, manifest: string | null) => Promise<void>
  failTransfer: (reason: string) => Promise<void>
  alert: (reason: string) => Promise<void>
  deleteTemp: () => Promise<"TEMP_DELETED" | "FAILED" | "SKIPPED" | "retry">
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
const SLOT_RETRY_MS = 60_000
const WAIT_REASON: Record<string, string> = {
  nas_down: "시놀로지에 닿지 않습니다",
  certificate: "시놀로지 인증서 지문이 달라졌습니다",
  disk_full: "시놀로지 디스크가 가득 찼습니다",
}

export async function runCopy(ops: CopyOps): Promise<string> {
  const plan = await ops.loadCopyPlan()
  if (!plan || plan.state === "TEMP_DELETED" || plan.state === "FAILED") return plan?.state ?? "GONE"

  /** 자리를 잡으면 true. 이 전송이 더 복사할 상태가 아니면 false — 자리를 기다리며 영원히 돌지 않게 */
  const claim = async (): Promise<boolean> => {
    for (;;) {
      const slot = await ops.claimCopySlot()
      if (slot !== "busy") return slot === "ok"
      await ops.sleep(SLOT_RETRY_MS)
    }
  }

  /** NAS 를 만날 때까지 기다린다. 기다리는 동안 DB 를 건드리지 않는다. false 면 한도를 넘겨 FAILED 로 끝났다 */
  const waitForNas = async (reason: string): Promise<boolean> => {
    const label = WAIT_REASON[reason] ?? reason
    const since = ops.now()
    let lastAlert = 0
    // 지문 · 디스크는 저절로 풀리지 않는다 — 바로 알린다
    if (reason !== "nas_down") {
      await ops.alert(label)
      lastAlert = ops.now()
    }
    for (let round = 0; ; round++) {
      await ops.sleep(nasWaitMs(round))
      if (await ops.probeNas()) return true
      const waited = ops.now() - since
      if (waited > WAIT_NAS_LIMIT_MS) {
        await ops.failTransfer(`${label} (30일)`)
        return false
      }
      // 1시간째 한 번, 그 뒤 매일
      if ((lastAlert === 0 && waited >= HOUR) || (lastAlert > 0 && ops.now() - lastAlert >= DAY)) {
        await ops.alert(label)
        lastAlert = ops.now()
      }
    }
  }

  if (plan.state !== "VERIFIED") {
    if (!(await claim())) return "SKIPPED"

    let index = plan.segmentsDone
    let manifest = plan.manifestSha256
    let mismatches = 0
    while (index < plan.segments) {
      let result: CopyResult
      try {
        result = await ops.copySegment(index, manifest)
      } catch {
        // 단계 재시도(기본 3회)가 다 실패했다. 임시본은 그대로니 기다렸다 이어 간다
        result = { kind: "nas_down" }
      }

      if (result.kind === "ok") {
        index++
        manifest = result.manifest
        mismatches = 0
        if (index % PROGRESS_EVERY_SEGMENTS === 0 && index < plan.segments) await ops.recordProgress(index, manifest)
      } else if (result.kind === "mismatch") {
        if (++mismatches >= SEGMENT_MISMATCH_LIMIT) {
          await ops.failTransfer(`조각 ${index} 의 해시가 ${SEGMENT_MISMATCH_LIMIT}번 달랐습니다`)
          return "FAILED"
        }
      } else if (result.kind === "blob_missing") {
        await ops.failTransfer("임시 저장소에 원본이 없습니다")
        return "FAILED"
      } else {
        await ops.markWaiting(index, manifest, result.kind)
        if (!(await waitForNas(result.kind))) return "FAILED"
        if (!(await claim())) return "SKIPPED"
      }
    }

    const whole = await ops.verifyWholeSize()
    if (!whole.ok) {
      await ops.failTransfer(`복사된 크기가 다릅니다 (${whole.actual ?? "없음"} ≠ ${whole.expected})`)
      return "FAILED"
    }
    await ops.markVerified(index, manifest)
  }

  await ops.sleep(TEMP_DELETE_DELAY_MS)
  // 지우기 직전에 한 번 더 대조한다. NAS 가 그새 꺼졌으면 기다렸다 다시 본다 — 그동안 임시본은 남아 있다
  for (let round = 0; ; round++) {
    const deleted = await ops.deleteTemp()
    if (deleted !== "retry") return deleted
    await ops.sleep(nasWaitMs(round))
  }
}

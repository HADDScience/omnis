// 확인 카드의 규칙 — 순수 함수(prisma 없음). 시험: lib/agent/approval.test.ts
//
// 세 가지를 코드로 지킨다. 모델 · SDK 설정과 무관하게 동작해야 한다.
//  1. 확인 없이 쓰기 불가 — 쓰기 도구는 APPROVED 카드가 있고, 그 카드의 도구 · 입력이 지금 실행하려는 것과 같을 때만 돈다
//  2. 보여 준 제안에만 승인 — 화면이 보낸 planHash 가 카드를 만들 때의 해시와 같아야 한다(그 사이 카드가 바뀌면 거절)
//  3. 한 번만 — PENDING 인 카드만 승인할 수 있다. DB 는 status=PENDING 조건부 갱신으로 한 번 더 막는다(lib/agent/runs.ts)
import { createHash } from "node:crypto"
import { secretBlockReason } from "./secrets"

/** 키 순서와 무관한 JSON — 같은 입력이면 같은 해시가 나오게 */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => x !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stableStringify(x)}`).join(",")}}`
}

export function planHash(p: { runId: string; toolCallId: string; toolName: string; input: unknown; preview: unknown }): string {
  return createHash("sha256")
    .update(stableStringify({ runId: p.runId, toolCallId: p.toolCallId, toolName: p.toolName, input: p.input, preview: p.preview }))
    .digest("hex")
}

export type StepStatus = "PENDING" | "APPROVED" | "REJECTED" | "BLOCKED" | "EXECUTED" | "FAILED" | "EXPIRED"

export interface StepForCheck {
  status: StepStatus
  toolName: string
  input: unknown
  planHash: string
  blockedReason: string | null
}

export type Check = { ok: true } | { ok: false; status: number; error: string }

/** 사람이 카드를 누를 때. ownerId 는 실행을 연 사람 — 남의 카드는 누를 수 없다 */
export function checkDecision(
  step: StepForCheck | null,
  req: { userId: string; ownerId: string; decision: "approve" | "reject"; planHash: string }
): Check {
  if (!step || req.userId !== req.ownerId) return { ok: false, status: 404, error: "확인할 제안을 찾을 수 없습니다" }
  if (step.status === "BLOCKED") return { ok: false, status: 409, error: step.blockedReason ?? "막힌 제안입니다" }
  if (step.status !== "PENDING") return { ok: false, status: 409, error: "이미 처리된 제안입니다" }
  if (req.planHash !== step.planHash) return { ok: false, status: 409, error: "화면의 제안이 바뀌었습니다. 새로고침한 뒤 다시 확인해 주세요" }
  if (req.decision === "approve") {
    const secret = secretBlockReason(step.input)
    if (secret) return { ok: false, status: 409, error: secret }
  }
  return { ok: true }
}

/** 쓰기 도구가 실제로 돌기 직전. step 은 그 도구 호출(toolCallId)의 카드 */
export function checkExecution(step: StepForCheck | null, call: { toolName: string; input: unknown }): Check {
  if (!step) return { ok: false, status: 403, error: "확인 카드가 없는 쓰기는 실행하지 않습니다" }
  if (step.status !== "APPROVED") {
    const why: Partial<Record<StepStatus, string>> = {
      PENDING: "아직 확인하지 않은 제안입니다",
      REJECTED: "취소한 제안입니다",
      BLOCKED: step.blockedReason ?? "막힌 제안입니다",
      EXECUTED: "이미 실행한 제안입니다 — 같은 승인은 한 번만 씁니다",
      FAILED: "이미 실행을 시도한 제안입니다",
      EXPIRED: "버려진 제안입니다",
    }
    return { ok: false, status: 409, error: why[step.status] ?? "실행할 수 없는 제안입니다" }
  }
  if (call.toolName !== step.toolName || stableStringify(call.input) !== stableStringify(step.input)) {
    return { ok: false, status: 409, error: "확인한 제안과 실행하려는 내용이 다릅니다" }
  }
  const secret = secretBlockReason(call.input)
  if (secret) return { ok: false, status: 409, error: secret }
  return { ok: true }
}

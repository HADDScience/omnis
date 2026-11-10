// 에이전트 대화(AI SDK ModelMessage[])에서 승인 요청을 찾고 승인 응답을 만든다. 순수 함수 — 시험: lib/agent/messages.test.ts
import type { ModelMessage } from "ai"

type Part = { type: string; [k: string]: unknown }

/** 대화 끝의 assistant 글에 붙은 승인 요청 — 아직 응답이 없는 것만 */
export function pendingApprovals(messages: ModelMessage[]): { approvalId: string; toolCallId: string; toolName: string; input: Record<string, unknown> }[] {
  const answered = new Set<string>()
  const calls = new Map<string, { toolName: string; input: Record<string, unknown> }>()
  const requests: { approvalId: string; toolCallId: string }[] = []
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue
    for (const p of m.content as Part[]) {
      if (p.type === "tool-call") calls.set(String(p.toolCallId), { toolName: String(p.toolName), input: (p.input ?? {}) as Record<string, unknown> })
      if (p.type === "tool-approval-request") requests.push({ approvalId: String(p.approvalId), toolCallId: String(p.toolCallId) })
      if (p.type === "tool-approval-response") answered.add(String(p.approvalId))
    }
  }
  return requests
    .filter((r) => !answered.has(r.approvalId) && calls.has(r.toolCallId))
    .map((r) => ({ ...r, ...calls.get(r.toolCallId)! }))
}

export function approvalResponses(steps: { approvalId: string; status: string; blockedReason: string | null }[]): ModelMessage {
  return {
    role: "tool",
    content: steps.map((s) => ({
      type: "tool-approval-response" as const,
      approvalId: s.approvalId,
      approved: s.status === "APPROVED",
      ...(s.status === "APPROVED"
        ? {}
        : { reason: s.status === "BLOCKED" ? `실행하지 않음 — ${s.blockedReason ?? "막힌 제안"}` : "사용자가 취소했습니다" }),
    })),
  } as ModelMessage
}


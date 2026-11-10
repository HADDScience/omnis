// 에이전트 라우트 공통 — 켜져 있는지 · 스트림 응답
import { createUIMessageStreamResponse } from "ai"
import { apiError } from "@/lib/api"
import { modelFor } from "@/lib/ai-models"
import { fakeAgentEnabled } from "./fake-model"

const KEY_ENV = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", google: "GEMINI_API_KEY" } as const

/** 에이전트를 못 쓰는 까닭 — 모델 키 · 승인 서명 비밀이 없다. 쓸 수 있으면 null. 시험 모델(./fake-model.ts)은 키 없이 돈다 */
export function agentOffReason(): string | null {
  const m = modelFor("agent")
  if (!fakeAgentEnabled() && !process.env[KEY_ENV[m.vendor]]) return "AI 기능이 비활성화되어 있습니다"
  if ((process.env.OMNIS_AGENT_APPROVAL_SECRET ?? "").length < 32) return "에이전트 승인 서명 설정이 없습니다"
  return null
}

/** 모델 키 · 승인 서명 비밀이 없으면 503 — 서명 없이 승인을 받지 않는다 */
export function agentDisabled() {
  const off = agentOffReason()
  return off ? apiError(503, off) : null
}

export function agentStream(stream: ReadableStream, headers: Record<string, string>) {
  return createUIMessageStreamResponse({ stream, headers: { ...headers, "Cache-Control": "no-store" } })
}

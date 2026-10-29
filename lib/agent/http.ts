// 에이전트 라우트 공통 — 켜져 있는지 · 스트림 응답
import { createUIMessageStreamResponse } from "ai"
import { apiError } from "@/lib/api"
import { modelFor } from "@/lib/ai-models"

const KEY_ENV = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", google: "GEMINI_API_KEY" } as const

/** 모델 키 · 승인 서명 비밀이 없으면 503 — 서명 없이 승인을 받지 않는다 */
export function agentDisabled() {
  const m = modelFor("agent")
  if (!process.env[KEY_ENV[m.vendor]]) return apiError(503, "AI 기능이 비활성화되어 있습니다")
  if ((process.env.OMNIS_AGENT_APPROVAL_SECRET ?? "").length < 32) return apiError(503, "에이전트 승인 서명 설정이 없습니다")
  return null
}

export function agentStream(stream: ReadableStream, headers: Record<string, string>) {
  return createUIMessageStreamResponse({ stream, headers: { ...headers, "Cache-Control": "no-store" } })
}

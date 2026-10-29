// 옴니스가 답하며 쓴 도구 — 실행의 대화(AgentRun.messages)에서 뽑는다. 순수 함수 — 시험: lib/agent/tool-trail.test.ts
//
// 답이 끝나도 · 새로고침해도 「무엇을 보고 답했는지」 가 남게 DB 의 대화에서 다시 그린다(2026-10-29 작업지시자).
// 결과 본문은 길어서(업무 목록 200건) 화면에는 앞 한두 줄만 보낸다.

export interface ToolUse {
  id: string
  name: string
  /** 인자 요약 — 「task: 판넬 제작 · deadline: 2026-11-12」 */
  input: string
  /** 결과 앞부분. 확인을 기다리면 「확인 카드」 */
  result: string
  state: "done" | "error" | "approval"
}

type Part = { type: string; [k: string]: unknown }
type Msg = { role: string; content: unknown }

const INPUT_MAX = 90
const RESULT_MAX = 140

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function value(v: unknown): string {
  if (v === null || v === undefined || v === "") return ""
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim()
  if (Array.isArray(v)) return v.map(value).filter(Boolean).join(", ")
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

export function summarizeInput(input: unknown): string {
  if (!input || typeof input !== "object") return ""
  const parts = Object.entries(input as Record<string, unknown>)
    .map(([k, v]) => [k, value(v)] as const)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${clip(v, 40)}`)
  return clip(parts.join(" · "), INPUT_MAX)
}

export function summarizeOutput(output: unknown): { text: string; error: boolean } {
  if (output === null || output === undefined) return { text: "", error: false }
  if (typeof output === "string") return { text: clip(output.replace(/\s+/g, " ").trim(), RESULT_MAX), error: false }
  const o = output as { type?: string; value?: unknown }
  const error = o.type === "error-text" || o.type === "error-json" || o.type === "execution-denied"
  if (o.type === "execution-denied") return { text: "실행하지 않음", error: true }
  const raw = typeof o.value === "string" ? o.value : value(o.value ?? output)
  return { text: clip(raw.replace(/\s+/g, " ").trim(), RESULT_MAX), error }
}

/** 대화 안의 도구 호출을 부른 순서대로. 같은 호출이 구간을 넘어 두 번 실려 있어도(확인 뒤 이어 가기) 한 번만 */
export function toolTrail(messages: Msg[]): ToolUse[] {
  const out = new Map<string, ToolUse>()
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue
    for (const p of m.content as Part[]) {
      const id = String(p.toolCallId ?? "")
      if (!id) continue
      if (p.type === "tool-call" && !out.has(id)) {
        out.set(id, { id, name: String(p.toolName ?? ""), input: summarizeInput(p.input), result: "", state: "done" })
      } else if (p.type === "tool-approval-request") {
        const t = out.get(id)
        if (t && !t.result) out.set(id, { ...t, state: "approval", result: "확인 카드" })
      } else if (p.type === "tool-result" || p.type === "tool-error") {
        const t = out.get(id)
        if (!t) continue
        const r = p.type === "tool-error" ? { text: clip(value(p.error), RESULT_MAX), error: true } : summarizeOutput(p.output)
        out.set(id, { ...t, result: r.text, state: r.error ? "error" : "done" })
      }
    }
  }
  return [...out.values()]
}

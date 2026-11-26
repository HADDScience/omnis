// 세션 이벤트 → 채팅방 진행 한 줄. 데이터만 다룬다(시험이 그대로 부른다).
// 이벤트 모양: @anthropic-ai/sdk resources/beta/sessions/events.d.ts(BetaManagedAgentsSessionEvent)

export interface EventLike {
  type: string
  name?: string
  input?: Record<string, unknown>
  content?: Array<{ type: string; text?: string }>
  error?: { message?: string; type?: string }
  stop_reason?: { type: string }
  processed_at?: string | null
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** 사람이 알아볼 이름 — 샌드박스 경로는 마지막 두 마디만 */
const pathOf = (p: unknown) => (typeof p === "string" ? p.split("/").slice(-2).join("/") : "")

/** 진행 한 줄. 보여 줄 것이 없으면 null(생각 · 내부 집계 이벤트) */
export function progressLine(e: EventLike): string | null {
  switch (e.type) {
    case "agent.tool_use": {
      const i = e.input ?? {}
      if (e.name === "bash") return `⚙︎ 명령: ${clip(String(i.command ?? ""), 70)}`
      if (e.name === "write") return `✎ 파일 쓰기: ${pathOf(i.file_path ?? i.path)}`
      if (e.name === "edit") return `✎ 파일 고치기: ${pathOf(i.file_path ?? i.path)}`
      if (e.name === "read") return `📄 읽기: ${pathOf(i.file_path ?? i.path)}`
      return `⚙︎ ${e.name ?? "도구"}`
    }
    case "agent.mcp_tool_use":
      return `🔎 옴니스 조회: ${e.name ?? ""}`
    case "agent.message": {
      const text = (e.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join(" ")
      return text.trim() ? `💬 ${clip(text, 120)}` : null
    }
    case "session.error":
      return `⚠︎ 오류: ${clip(e.error?.message ?? "알 수 없음", 120)}`
    case "session.status_idle":
      if (e.stop_reason?.type === "budget_reached") return "⏸ 작업 1건 상한에 닿아 멈췄습니다"
      return null
    default:
      return null
  }
}

/** 채팅방이 넘치지 않게 — 같은 줄 연속은 하나로, 한 번에 최대 n 줄. 넘친 수를 함께 돌려준다 */
export function compactLines(lines: string[], max = 8): { lines: string[]; dropped: number } {
  const out: string[] = []
  for (const l of lines) if (out[out.length - 1] !== l) out.push(l)
  if (out.length <= max) return { lines: out, dropped: 0 }
  return { lines: [...out.slice(0, max - 1), out[out.length - 1]], dropped: out.length - max }
}

export type IdleOutcome = "done" | "needs_budget" | "needs_action" | "failed"

/** 멈춘 이유 → 다음 할 일 */
export function idleOutcome(stopReason: string | undefined): IdleOutcome {
  if (stopReason === "end_turn") return "done"
  if (stopReason === "budget_reached") return "needs_budget"
  if (stopReason === "requires_action") return "needs_action"
  return "failed"
}

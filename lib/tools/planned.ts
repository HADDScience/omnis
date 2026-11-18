// 계획을 먼저 세우는 쓰기 도구(#248) — CRM 쓰기(lib/crm-write-tools.ts)와 같은 모양을 다른 업무 데이터에도 쓴다.
//
// 도구 하나 = 계획 함수 하나. 계획은 「무엇이 → 어떻게 바뀌나」 를 보여 주고, 확인되면 run 이 화면 API 와 같은 서버 함수를 부른다.
//   MCP        → confirm=true 일 때만 run, 아니면 계획 글(미리보기)
//   앱 AI      → 계획이 확인 카드가 되고, 카드를 누르면 confirm=true 로 다시 계획을 세워 run(그 사이 바뀐 것을 반영)
//   질문 경로  → confirm 칸을 지우고 부르므로 늘 미리보기
// 권한은 계획 안에서 화면과 똑같이 본다 — 막히면 problem 을 채워 카드도 실행도 막는다.
import type { Caller } from "@/lib/omnis-mcp"

export interface PlanChange {
  label: string
  /** null 이면 새로 생기는 것 */
  before: string | null
  after: string
}

export type RunResult = { ok: true; text: string; id?: string } | { ok: false; error: string }

export interface WritePlan {
  title: string
  target: string
  changes: PlanChange[]
  /** 확인하면 무슨 일이 따라오나 */
  risk: string
  /** 확인은 되지만 눈여겨볼 것 */
  warning?: string
  /** 실행해도 실패할 이유(권한 · 없는 대상 · 잘못된 입력) — 있으면 막는다 */
  problem?: string
  /** 확인 단추 글 — 지우기는 「지우기」 */
  confirmLabel?: string
  /** 확인되면 부른다. problem 이 없으면 있어야 한다 */
  run?: () => Promise<RunResult>
}

export type Planner = (args: Record<string, unknown>, caller: Caller) => Promise<WritePlan>

/** 계획을 MCP · 질문 경로에 돌려줄 글로 */
export function planText(p: WritePlan): string {
  return [
    `${p.title} — ${p.target}`,
    ...p.changes.map((c) => `- ${c.label}: ${c.before !== null ? `${c.before} → ${c.after}` : c.after}`),
    p.warning ? `⚠ ${p.warning}` : null,
    p.risk ? `(${p.risk})` : null,
  ].filter(Boolean).join("\n")
}

/** confirm 이 true 가 아니면 미리보기만. true 면 계획을 다시 세워 run */
export async function runPlanned(planner: Planner, args: Record<string, unknown>, caller: Caller): Promise<{ text: string } | { error: string }> {
  const plan = await planner(args, caller)
  if (plan.problem || !plan.run) return { error: plan.problem ?? "입력을 읽지 못했습니다." }
  if (args.confirm !== true) {
    return { text: `아직 쓰지 않았습니다. 아래 내용을 사용자에게 보여 주고 동의를 받은 뒤 confirm=true 로 다시 부르세요.\n${planText(plan)}` }
  }
  const r = await plan.run()
  if (!r.ok) return { error: r.error }
  return { text: [r.text, ...plan.changes.map((c) => `- ${c.label}: ${c.before !== null ? `${c.before} → ${c.after}` : c.after}`)].join("\n") }
}

// ─── 계획에서 자주 쓰는 도우미 ───

export const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")
export const has = (args: Record<string, unknown>, k: string) => args[k] !== undefined && args[k] !== null
export const clip = (v: string, n = 200) => (v.length > n ? `${v.slice(0, n)}…` : v)
export const kstDate = (d: Date | null | undefined) => (d ? d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10) : "없음")

/** 계획을 못 세우는 경우 — 제목만 두고 막는다 */
export function blocked(title: string, target: string, problem: string): WritePlan {
  return { title, target, changes: [], risk: "", problem }
}

/** confirm 칸 — 모든 계획 쓰기 도구가 같은 글로 받는다 */
export const CONFIRM_PROP = {
  type: "boolean",
  description: "true 일 때만 실제로 씁니다. 없으면 바뀔 내용만 돌려줍니다 — 사용자에게 보여 주고 동의를 받은 뒤 true 로 다시 부르세요.",
} as const

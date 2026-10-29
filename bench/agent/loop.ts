// 벤더 중립 에이전트 루프 — 모델이 도구를 그만 부르고 답할 때까지 턴을 돈다.
//
// 상한 둘: 턴 수(기본 12)와 과제 1건당 원(기본 1,000원). 넘으면 거기서 끊고 오류로 적는다 —
// 운영 에이전트도 실행당 상한을 두기로 했다(계획서 3단계, folding 의 24턴/$2.00 참고).
import type { Caller } from "@/lib/omnis-mcp"
import { usdToKrw, type ModelSpec } from "../config"
import { costUsd, now } from "../providers"
import type { Driver } from "./drivers"
import { executeTool, type ToolContext } from "./tools"
import { addAgentUsage, ZERO_AGENT_USAGE, type AgentUsage, type Proposal, type TurnRecord } from "./types"

export interface LoopOptions {
  maxTurns: number
  maxKrwPerTask: number
  dryRun: boolean
}

export interface LoopResult {
  answer: string
  proposals: Proposal[]
  turns: TurnRecord[]
  usage: AgentUsage
  costUsd: number
  ms: number
  evidence: string[]
  error?: string
  note?: string
}

/** 캐시 쓰기는 입력 단가의 1.25배 — costUsd 는 입력 단가로 셌으니 0.25배를 더한다 */
export function agentCostUsd(u: AgentUsage, m: ModelSpec): number {
  return costUsd(u, m.price) + (u.cacheWrite * m.price.input * 0.25) / 1_000_000
}

export async function runAgentLoop(driver: Driver, model: ModelSpec, caller: Caller, opts: LoopOptions): Promise<LoopResult> {
  const t0 = now()
  const proposals: Proposal[] = []
  const turns: TurnRecord[] = []
  const evidence: string[] = []
  let usage = ZERO_AGENT_USAGE
  const finish = (answer: string, extra: Partial<LoopResult> = {}): LoopResult => ({
    answer, proposals, turns, usage, costUsd: agentCostUsd(usage, model), ms: Math.round(now() - t0), evidence, ...extra,
  })

  for (let turn = 1; turn <= opts.maxTurns; turn++) {
    let out
    try {
      out = await driver.turn()
    } catch (err) {
      return finish("", { error: String(err).slice(0, 500) })
    }
    usage = addAgentUsage(usage, out.usage)
    const rec: TurnRecord = {
      turn, ms: Math.round(out.ms), usage: out.usage, estInput: out.estInput, estOutput: out.estOutput,
      stop: out.stop, text: out.text.slice(0, 400), calls: [],
    }
    turns.push(rec)

    if (out.stop === "refusal") return finish(out.text, { error: "refusal: 모델이 거절(stop_reason=refusal)" })
    if (out.calls.length === 0) {
      const note = out.stop === "max_tokens" || out.stop === "MAX_TOKENS" ? "출력 상한에서 잘림" : undefined
      return finish(out.text.trim(), note ? { note } : {})
    }

    const ctx: ToolContext = { caller, dryRun: opts.dryRun, proposals, turn, evidence }
    const results = []
    for (const call of out.calls) {
      const r = await executeTool(call.name, call.args, ctx)
      rec.calls.push({ name: call.name, args: call.args, kind: r.kind, resultChars: r.text.length, ms: Math.round(r.ms) })
      results.push({ id: call.id, name: call.name, text: r.text, isError: r.isError })
    }
    driver.pushToolResults(results)

    const krw = usdToKrw(agentCostUsd(usage, model))
    if (krw > opts.maxKrwPerTask) return finish(out.text.trim(), { error: `건당 상한 ${opts.maxKrwPerTask}원 초과 (${krw}원, ${turn}턴)에서 중단` })
  }
  return finish("", { error: `턴 상한 ${opts.maxTurns} 안에 답을 내지 못함` })
}

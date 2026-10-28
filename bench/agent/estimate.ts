// 돌리기 전 비용 추산 — dry-run(정답 스크립트)이 실제 DB 를 읽으며 쌓은 요청 크기로 모델별 건당 원을 센다.
//
//   npx tsx bench/agent/estimate.ts bench/results/agent-<run>     # dry-run 결과 폴더
//
// 가정 (돌린 뒤 실측과 견주어 고친다):
//   - 토큰 = drivers.estTokens (한글 1자 ≈ 1토큰, 나머지 3.2자 ≈ 1토큰)
//   - 턴마다 thinking·서두 출력 THINK_PER_TURN 토큰을 더한다
//   - Claude 는 자동 캐시: 직전 턴까지의 앞부분은 캐시 읽기, 새로 붙은 부분은 캐시 쓰기(1.25배)
//   - Gemini 는 암묵 캐시를 가정하지 않는다 (상한 쪽)
//   - "턴 2배" 열: 실제 모델은 정답 스크립트(2~3턴)보다 많이 돈다. 입력 ×2.5 · 출력 ×2 로 본다
import { readFileSync } from "fs"
import { join } from "path"
import { AGENT_MODELS, usdToKrw, type ModelSpec } from "../config"
import { judgeModel } from "./grade"
import type { AgentRow } from "./types"

export const THINK_PER_TURN = 600

export interface Estimate {
  model: string
  inTokens: number
  outTokens: number
  krw: number
  krwLong: number
}

function rowUsd(r: AgentRow, m: ModelSpec): { inUsd: number; outUsd: number; inTok: number; outTok: number } {
  let inUsd = 0
  let outUsd = 0
  let prev = 0
  let inTok = 0
  let outTok = 0
  const cachedRate = m.price.cachedInput ?? m.price.input
  for (const t of r.turns) {
    const I = t.estInput
    const O = t.estOutput + THINK_PER_TURN
    inTok += I
    outTok += O
    if (m.provider === "anthropic") {
      inUsd += (Math.min(prev, I) * cachedRate + Math.max(I - prev, 0) * m.price.input * 1.25) / 1e6
      prev = I + t.estOutput
    } else {
      inUsd += (I * m.price.input) / 1e6
    }
    outUsd += (O * m.price.output) / 1e6
  }
  return { inUsd, outUsd, inTok, outTok }
}

export function estimate(rows: AgentRow[], models: ModelSpec[] = AGENT_MODELS): { perModel: Estimate[]; judgeKrw: number; tasks: number } {
  const ref = rows.filter((r) => r.model === "dry-perfect")
  const tasks = new Set(ref.map((r) => r.taskId)).size
  const perModel = models.map((m) => {
    let inUsd = 0, outUsd = 0, inT = 0, outT = 0
    for (const r of ref) { const x = rowUsd(r, m); inUsd += x.inUsd; outUsd += x.outUsd; inT += x.inTok; outT += x.outTok }
    const n = Math.max(ref.length, 1)
    // 턴 2배: 입력은 대화가 길어지며 턴 수보다 빨리 는다 → 2.5배, 출력 2배
    const longUsd = inUsd * 2.5 + outUsd * 2
    return { model: m.key, inTokens: Math.round(inT / n), outTokens: Math.round(outT / n), krw: usdToKrw((inUsd + outUsd) / n), krwLong: usdToKrw(longUsd / n) }
  })
  const j = judgeModel()
  const judgeUsd = ref.reduce((a, r) => a + (r.judgeEstInput * j.price.input + 400 * j.price.output) / 1e6, 0) / Math.max(ref.length, 1)
  return { perModel, judgeKrw: usdToKrw(judgeUsd), tasks }
}

export function estimateMarkdown(rows: AgentRow[], repeat = 2): string {
  const { perModel, judgeKrw, tasks } = estimate(rows)
  if (tasks === 0) return ""
  const lines = [
    `## 돌리기 전 비용 추산 (dry-run 요청 크기 기준)`,
    ``,
    `과제 ${tasks}개 · 정답 스크립트가 실제 로컬 DB 를 읽어 쌓은 요청 크기. 토큰은 추정식(한글 1자≈1, 그 밖 3.2자≈1), 턴마다 thinking ${THINK_PER_TURN}토큰 가정.`,
    `"턴 2배" 는 모델이 스크립트보다 길게 도는 경우(입력 ×2.5 · 출력 ×2). 심판(${judgeModel().key})은 건당 약 ${judgeKrw}원.`,
    ``,
    `| 모델 | 건당 입력 토큰(추정) | 건당 원 | 건당 원 (턴 2배) | 2건 시험 (턴 2배 + 심판) | 전체 ${tasks}×${repeat}건 (턴 2배 + 심판) |`,
    `|---|---:|---:|---:|---:|---:|`,
    ...perModel.map((e) => `| ${e.model} | ${e.inTokens.toLocaleString()} | ${e.krw} | ${e.krwLong} | ${Math.round(2 * (e.krwLong + judgeKrw))}원 | ${Math.round(tasks * repeat * (e.krwLong + judgeKrw)).toLocaleString()}원 |`),
  ]
  const total = perModel.reduce((a, e) => a + tasks * repeat * (e.krwLong + judgeKrw), 0)
  const pilot = perModel.reduce((a, e) => a + 2 * (e.krwLong + judgeKrw), 0)
  lines.push(``, `합계 — 모델별 2건 시험: 약 ${Math.round(pilot).toLocaleString()}원 · 전체: 약 ${Math.round(total).toLocaleString()}원`)
  return lines.join("\n")
}

if (process.argv[1]?.endsWith("estimate.ts")) {
  const dir = process.argv[2]
  if (!dir) throw new Error("사용법: npx tsx bench/agent/estimate.ts bench/results/agent-<run> [--repeat 2]")
  const i = process.argv.indexOf("--repeat")
  const rows = readFileSync(join(dir, "results.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as AgentRow)
  console.log(estimateMarkdown(rows, i > 0 ? Number(process.argv[i + 1]) : 2))
}

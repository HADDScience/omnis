// 심판 — 답변을 기대 근거에 비추어 0·1·2 점으로 매긴다.
//
// 두 지표를 같이 남긴다.
//   hits   기대 문자열이 답변에 들어 있는 개수 (기존 import-tools/eval.ts 의 거친 지표, 결정적)
//   judge  심판 모델의 점수 + 환각 여부 + 한 줄 이유 (사람이 읽고 재확인하는 용도)
// 심판 비용은 결과에 따로 기록하고 방법론 비용에 섞지 않는다.
//
// v4 확장 (mydocs/plans/2026-10-06-weknora-lab.md "지표"):
//   - 과정 점수 0~2: 도구 자취가 있을 때만 매긴다 (없으면 null — 옛 행·단발 방법은 빈칸).
//     필요 근거(gold · minSteps · 출제 메모)와 모델이 실제로 본 문서(seen)를 같이 준다.
//   - 유형별 규칙: unanswerable(없다/모른다면 2, 지어내면 0·환각) · stale(옛 값을 현재 값으로 말하면 0) ·
//     ambiguous(되묻거나 가정을 밝히면 2). 같은 호출 한 번으로 매겨 심판 원가는 거의 그대로다.
//
// 구독 심판(claude-cli, config.ts JUDGES):
//   judgeMany 가 문항 BENCH_JUDGE_BATCH(기본 10)개를 한 프롬프트로 묶어 JSON 배열로 받는다. 채점 기준·유형 규칙·
//   과정 블록은 단건과 같은 문구를 쓰고, 문항마다 id 로 구획을 나눠 서로 섞이지 않게 한다. 배열이 깨지거나 빠진
//   문항만 단건으로 다시 묻는다. 묶음은 BENCH_JUDGE_CONCURRENCY(기본 2)개까지 동시에 보낸다.
import { JUDGE_MODEL, JUDGE_LABEL } from "./config"
import { complete, chat, costUsd, type Usage } from "./providers"
import { ClaudeLimitError } from "./claude-cli"
import type { ResultRow } from "./run"
import type { GoldRef } from "./questions"

export interface JudgeResult {
  score: 0 | 1 | 2
  hallucination: boolean
  reason: string
  /** 과정 점수. 도구 자취가 없는 방법은 null */
  process?: 0 | 1 | 2 | null
  processReason?: string
  usage: Usage
  costUsd: number
  ms: number
  /** 심판 이름 (config JUDGE_LABEL) */
  model: string
  /** claude-cli 만: API 요금표 환산액. 묶음 채점이면 호출 환산액을 문항 수로 나눈 몫 */
  notionalUsd?: number
}

/** v4 선택 입력. 기존 호출처(tests/scenario/_omnis-ask.ts)는 앞 네 인자만 넘긴다 */
export interface JudgeV4 {
  type?: string
  stale?: string[]
  unanswerable?: boolean
  minSteps?: number
  gold?: GoldRef[]
  note?: string
  /** 도구 호출 자취 — 있으면 과정 점수를 매긴다 */
  trace?: { step: number; tool: string; args: Record<string, unknown>; resultChars: number }[]
  /** 모델이 본 문서 "SOURCE:sourceId" */
  seen?: string[]
}

export function expectHits(answer: string, expect: string[]): string[] {
  return expect.filter((e) => answer.includes(e))
}

function typeRules(i: JudgeV4): string {
  const rules: string[] = []
  if (i.unanswerable || i.type === "unanswerable") {
    rules.push("- 이 질문은 사내 자료에 답이 없다. 「찾지 못했습니다」「기록이 없습니다」처럼 없다·모른다고 답했으면 2. 그럴듯한 답을 지어냈으면 0 이고 hallucination=true. 없다고 하면서 비슷한 다른 사실을 덧붙인 것은 그 사실이 자료에 있으면 감점하지 않는다.")
  }
  if (i.type === "stale" || i.stale?.length) {
    rules.push(`- 이 질문은 결정이 중간에 바뀌었다. 옛 값${i.stale?.length ? ` (${i.stale.map((s) => `「${s}」`).join(", ")})` : ""}을 현재(최종) 값으로 말했으면 0. 옛 값을 "처음엔 …였다가 바뀌었다" 처럼 경과로만 언급하고 최종 값을 맞게 말한 것은 감점하지 않는다.`)
  }
  if (i.type === "ambiguous") {
    rules.push("- 이 질문은 가리키는 대상이 둘 이상이다. 어느 쪽인지 되물었거나, 대상을 나눠 각각 답했거나, 어떤 가정으로 답하는지 밝혔으면 2. 대상 하나만 골라 가정도 밝히지 않고 답했으면 많아야 1.")
  }
  return rules.length ? `\n[이 문항의 규칙 — 위 기준보다 우선]\n${rules.join("\n")}\n` : ""
}

function processBlock(i: JudgeV4): string {
  if (!i.trace?.length) return ""
  const seen = new Set(i.seen ?? [])
  const gold = (i.gold ?? []).map((g) => `- ${g.source} ${g.sourceId}${i.seen ? (seen.has(`${g.source}:${g.sourceId}`) ? " (비서가 봄)" : " (비서가 못 봄)") : ""}`)
  const steps = i.trace.map((t) => `${t.step}. ${t.tool}(${JSON.stringify(t.args).slice(0, 160)}) → ${t.resultChars}자`)
  return `
[비서의 도구 호출 순서 (번호 = 모델 호출 차례, 같은 번호는 한 턴에 함께 부름)]
${steps.join("\n")}

[답에 필요한 근거]
최소 단계 수: ${i.minSteps ?? "(없음)"}
정답 근거 문서:
${gold.length ? gold.join("\n") : "- (지정 없음 — 답이 없는 문항이거나 근거가 DB 조회 결과)"}
출제 메모: ${i.note ?? "(없음)"}

과정 채점 기준 (process):
- 2: 답에 필요한 근거를 모두 찾아 서로 연결했다 (단계가 여럿이면 각 단계를 다 밟았다). 답이 없는 문항이면 그럴듯한 곳을 찾아본 뒤 멈췄다.
- 1: 일부 근거만 찾았거나, 찾은 근거를 잇지 못했거나, 같은 검색을 헛되이 되풀이했다.
- 0: 필요한 근거를 찾지 못했거나, 도구 결과와 무관하게 답했다.
정답 근거 문서를 "못 봄" 이라도 같은 사실을 다른 도구(목록·CRM·DB 조회) 결과로 확인했으면 찾은 것으로 본다.
`
}

const CRITERIA = `- 2: 핵심 사실을 모두 담았고 틀린 내용이 없다. 표현이 달라도(예: "10시 반" = "10시 30분") 뜻이 같으면 인정한다.
- 1: 핵심 사실 일부만 담았거나, 맞는 내용에 사소한 오류가 섞였다.
- 0: 핵심 사실이 없거나, "찾지 못했습니다" 로 답했거나, 틀린 내용이 주가 된다.
- hallucination: [비서가 실제로 본 자료]에도 [핵심 사실]에도 없는 구체적 사실(날짜·이름·수치·결정)을 지어냈으면 true. 자료에 있는 날짜·이름을 옮긴 것은 환각이 아니다. 자료가 "(생략)" 이면 핵심 사실과 모순될 때만 true. "찾지 못했습니다" 는 false.`

/** 구독 심판의 시스템 프롬프트. Claude Code 기본 프롬프트를 대신한다 (도구·코딩 지시가 끼지 않게) */
const CLI_SYSTEM = "당신은 사내 지식 비서의 답변을 채점하는 심판입니다. 사용자 메시지의 채점 기준을 그대로 적용하고, 요청한 JSON 만 출력합니다. 도구를 쓰지 않고 설명을 덧붙이지 않습니다."

function caseBlock(question: string, expect: string[], answer: string, evidence: string): string {
  return `[질문]
${question}

[정답에 들어 있어야 하는 핵심 사실]
${expect.length ? expect.map((e) => `- ${e}`).join("\n") : "- (없음)"}

[비서가 실제로 본 자료 (일부)]
${evidence || "(없음)"}

[비서의 답변]
${answer || "(빈 답변)"}`
}

type Parsed = { score?: number; hallucination?: boolean; reason?: string; process?: number | null; processReason?: string }

function toResult(parsed: Parsed | null, raw: string, withProcess: boolean): Pick<JudgeResult, "score" | "hallucination" | "reason" | "process" | "processReason"> {
  const p = parsed ?? {}
  return {
    score: p.score === 2 ? 2 : p.score === 1 ? 1 : 0,
    hallucination: p.hallucination === true,
    reason: p.reason ?? `(심판 응답 해석 실패: ${raw.slice(0, 80)})`,
    process: !withProcess ? null : p.process === 2 ? 2 : p.process === 1 ? 1 : p.process === 0 ? 0 : null,
    processReason: withProcess ? p.processReason ?? "" : undefined,
  }
}

export async function judge(question: string, expect: string[], answer: string, evidence: string, i: JudgeV4 = {}): Promise<JudgeResult> {
  const withProcess = !!i.trace?.length
  const prompt = `당신은 사내 지식 비서의 답변을 채점하는 심판입니다.

${caseBlock(question, expect, answer, evidence)}

채점 기준:
${CRITERIA}
${typeRules(i)}${processBlock(i)}
JSON 만 반환: {"score": 0|1|2, "hallucination": true|false, "reason": "한 줄"${withProcess ? `, "process": 0|1|2, "processReason": "한 줄"` : ""}}`

  const r = JUDGE_MODEL.provider === "claude-cli"
    ? await chat(JUDGE_MODEL, CLI_SYSTEM, [{ role: "user", content: prompt }])
    : await complete(JUDGE_MODEL, prompt, { temperature: 0, maxOutputTokens: 2048 })
  const m = r.text.match(/\{[\s\S]*\}/)
  let parsed: Parsed | null = null
  try { parsed = m ? JSON.parse(m[0]) : null } catch { /* 아래 기본값 */ }
  return {
    ...toResult(parsed, r.text, withProcess),
    usage: r.usage,
    costUsd: costUsd(r.usage, JUDGE_MODEL.price),
    ms: r.ms,
    model: JUDGE_LABEL,
    notionalUsd: r.notionalUsd,
  }
}

// ─── 묶음 채점 (구독 심판) ──────────────────────────────────────

export interface JudgeItem {
  /** 호출한 쪽이 결과를 찾는 키 (예: "모델|방법|qid") */
  key: string
  question: string
  expect: string[]
  answer: string
  evidence: string
  input: JudgeV4
}

export const JUDGE_BATCH = Math.max(1, Number(process.env.BENCH_JUDGE_BATCH ?? 10))
export const JUDGE_CONCURRENCY = Math.max(1, Number(process.env.BENCH_JUDGE_CONCURRENCY ?? 2))

function batchPrompt(items: JudgeItem[]): string {
  const cases = items.map((it, n) => {
    const id = `q${n + 1}`
    return `===== 문항 ${id} 시작 =====
${caseBlock(it.question, it.expect, it.answer, it.evidence)}
${typeRules(it.input)}${processBlock(it.input)}${it.input.trace?.length ? "" : "\n(이 문항은 과정 채점 없음 — process 는 null)\n"}===== 문항 ${id} 끝 =====`
  })
  return `당신은 사내 지식 비서의 답변을 채점하는 심판입니다. 아래 문항 ${items.length}개를 하나씩 따로 채점합니다.
문항끼리는 서로 관계가 없습니다. 한 문항의 질문·자료·답변·규칙을 다른 문항 채점에 쓰지 마십시오.
"[이 문항의 규칙]" 과 과정 채점 기준은 그 문항 안에서만 적용됩니다.

채점 기준 (모든 문항 공통):
${CRITERIA}

${cases.join("\n\n")}

JSON 배열만 반환. 문항마다 한 항목, 위 순서대로 ${items.length}개:
[{"id": "q1", "score": 0|1|2, "hallucination": true|false, "reason": "한 줄", "process": 0|1|2|null, "processReason": "한 줄"}, …]
과정 채점이 없는 문항은 "process": null, "processReason": "".`
}

function parseArray(text: string): Parsed[] | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "")
  const a = cleaned.indexOf("["), b = cleaned.lastIndexOf("]")
  if (a < 0 || b < a) return null
  try {
    const v = JSON.parse(cleaned.slice(a, b + 1))
    return Array.isArray(v) ? v : null
  } catch { return null }
}

/**
 * 여러 문항을 채점한다. claude-cli 심판이면 묶어서, 그 밖은 한 건씩 judge().
 * 결과는 끝나는 대로 onDone 으로 넘긴다 — 중간에 멈춰도 받은 것은 남는다.
 * 구독 한도에 걸리면 새 묶음을 시작하지 않고, 진행 중인 것을 마친 뒤 ClaudeLimitError 를 던진다.
 * 그 밖의 오류로 끝내 채점하지 못한 문항은 onFail 로 넘기고 계속한다.
 */
export async function judgeMany(
  items: JudgeItem[],
  onDone: (key: string, r: JudgeResult) => void,
  onFail: (key: string, err: string) => void = () => {},
): Promise<{ calls: number; notionalUsd: number }> {
  const batched = JUDGE_MODEL.provider === "claude-cli"
  const size = batched ? JUDGE_BATCH : 1
  const chunks: JudgeItem[][] = []
  for (let k = 0; k < items.length; k += size) chunks.push(items.slice(k, k + size))
  let calls = 0
  let notional = 0
  let limit: ClaudeLimitError | null = null

  const single = async (it: JudgeItem) => {
    try {
      calls++
      const r = await judge(it.question, it.expect, it.answer, it.evidence, it.input)
      notional += r.notionalUsd ?? 0
      onDone(it.key, r)
    } catch (err) {
      if (err instanceof ClaudeLimitError) throw err
      onFail(it.key, String(err).slice(0, 200))
    }
  }

  const runChunk = async (chunk: JudgeItem[]) => {
    if (chunk.length === 1) return single(chunk[0])
    let r: Awaited<ReturnType<typeof chat>> | null = null
    let lastErr = ""
    // 묶음 호출은 한 번 다시 시도한다 — 실패하면 문항 전부가 날아가서
    for (let attempt = 0; attempt < 2 && !r; attempt++) {
      try { calls++; r = await chat(JUDGE_MODEL, CLI_SYSTEM, [{ role: "user", content: batchPrompt(chunk) }]) } catch (err) {
        if (err instanceof ClaudeLimitError) throw err
        lastErr = String(err).slice(0, 200)
      }
    }
    if (!r) { for (const it of chunk) onFail(it.key, `묶음 호출 실패: ${lastErr}`); return }
    notional += r.notionalUsd ?? 0
    const arr = parseArray(r.text) ?? []
    const byId = new Map(arr.filter((x) => x && typeof (x as { id?: unknown }).id === "string").map((x) => [(x as { id: string }).id, x]))
    // 호출 하나의 사용량·환산액을 문항 수로 나눠 행마다 남긴다
    const share = 1 / chunk.length
    const usage: Usage = { input: Math.round(r.usage.input * share), output: Math.round(r.usage.output * share), thinking: 0, cached: Math.round(r.usage.cached * share) }
    const missing: JudgeItem[] = []
    chunk.forEach((it, n) => {
      const p = byId.get(`q${n + 1}`)
      if (!p || (p.score !== 0 && p.score !== 1 && p.score !== 2)) return missing.push(it)
      onDone(it.key, {
        ...toResult(p, "", !!it.input.trace?.length),
        usage, costUsd: costUsd(usage, JUDGE_MODEL.price), ms: Math.round(r.ms * share), model: JUDGE_LABEL,
        notionalUsd: (r.notionalUsd ?? 0) * share,
      })
    })
    // 배열이 깨졌거나 빠진 문항만 단건으로
    for (const it of missing) await single(it)
  }

  let next = 0
  await Promise.all(Array.from({ length: Math.min(batched ? JUDGE_CONCURRENCY : 1, chunks.length) }, async () => {
    while (!limit && next < chunks.length) {
      const chunk = chunks[next++]
      try { await runChunk(chunk) } catch (err) {
        if (err instanceof ClaudeLimitError) limit = err
        else for (const it of chunk) onFail(it.key, String(err).slice(0, 200))
      }
    }
  }))
  if (limit) throw limit
  return { calls, notionalUsd: notional }
}

/** 심판 결과 → 결과 행 필드 (run.ts · rejudge.ts). 구독 심판이면 환산액·토큰을 따로 남긴다 */
export function judgedFields(res: JudgeResult): Pick<ResultRow, "judge" | "judgeModel" | "judgeNotionalUsd" | "judgeUsage" | "judgePending"> {
  return {
    judge: { score: res.score, hallucination: res.hallucination, reason: res.reason, process: res.process, processReason: res.processReason, costUsd: res.costUsd },
    judgeModel: res.model,
    ...(res.notionalUsd !== undefined ? { judgeNotionalUsd: res.notionalUsd, judgeUsage: res.usage } : {}),
    judgePending: undefined,
  }
}

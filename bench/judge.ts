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
import { JUDGE_MODEL } from "./config"
import { complete, costUsd, type Usage } from "./providers"
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

export async function judge(question: string, expect: string[], answer: string, evidence: string, i: JudgeV4 = {}): Promise<JudgeResult> {
  const withProcess = !!i.trace?.length
  const prompt = `당신은 사내 지식 비서의 답변을 채점하는 심판입니다.

[질문]
${question}

[정답에 들어 있어야 하는 핵심 사실]
${expect.length ? expect.map((e) => `- ${e}`).join("\n") : "- (없음)"}

[비서가 실제로 본 자료 (일부)]
${evidence || "(없음)"}

[비서의 답변]
${answer || "(빈 답변)"}

채점 기준:
- 2: 핵심 사실을 모두 담았고 틀린 내용이 없다. 표현이 달라도(예: "10시 반" = "10시 30분") 뜻이 같으면 인정한다.
- 1: 핵심 사실 일부만 담았거나, 맞는 내용에 사소한 오류가 섞였다.
- 0: 핵심 사실이 없거나, "찾지 못했습니다" 로 답했거나, 틀린 내용이 주가 된다.
- hallucination: [비서가 실제로 본 자료]에도 [핵심 사실]에도 없는 구체적 사실(날짜·이름·수치·결정)을 지어냈으면 true. 자료에 있는 날짜·이름을 옮긴 것은 환각이 아니다. 자료가 "(생략)" 이면 핵심 사실과 모순될 때만 true. "찾지 못했습니다" 는 false.
${typeRules(i)}${processBlock(i)}
JSON 만 반환: {"score": 0|1|2, "hallucination": true|false, "reason": "한 줄"${withProcess ? `, "process": 0|1|2, "processReason": "한 줄"` : ""}}`

  const r = await complete(JUDGE_MODEL, prompt, { temperature: 0, maxOutputTokens: 2048 })
  const m = r.text.match(/\{[\s\S]*\}/)
  let parsed: { score?: number; hallucination?: boolean; reason?: string; process?: number; processReason?: string } = {}
  try { parsed = m ? JSON.parse(m[0]) : {} } catch { /* 아래 기본값 */ }
  const score = parsed.score === 2 ? 2 : parsed.score === 1 ? 1 : 0
  const process = !withProcess ? null : parsed.process === 2 ? 2 : parsed.process === 1 ? 1 : parsed.process === 0 ? 0 : null
  return {
    score,
    hallucination: parsed.hallucination === true,
    reason: parsed.reason ?? `(심판 응답 해석 실패: ${r.text.slice(0, 80)})`,
    process,
    processReason: withProcess ? parsed.processReason ?? "" : undefined,
    usage: r.usage,
    costUsd: costUsd(r.usage, JUDGE_MODEL.price),
    ms: r.ms,
  }
}

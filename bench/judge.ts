// 심판 — 답변을 기대 근거에 비추어 0·1·2 점으로 매긴다.
//
// 두 지표를 같이 남긴다.
//   hits   기대 문자열이 답변에 들어 있는 개수 (기존 import-tools/eval.ts 의 거친 지표, 결정적)
//   judge  심판 모델의 점수 + 환각 여부 + 한 줄 이유 (사람이 읽고 재확인하는 용도)
// 심판 비용은 결과에 따로 기록하고 방법론 비용에 섞지 않는다.
import { JUDGE_MODEL } from "./config"
import { complete, costUsd, type Usage } from "./providers"

export interface JudgeResult {
  score: 0 | 1 | 2
  hallucination: boolean
  reason: string
  usage: Usage
  costUsd: number
  ms: number
}

export function expectHits(answer: string, expect: string[]): string[] {
  return expect.filter((e) => answer.includes(e))
}

export async function judge(question: string, expect: string[], answer: string, evidence: string): Promise<JudgeResult> {
  const prompt = `당신은 사내 지식 비서의 답변을 채점하는 심판입니다.

[질문]
${question}

[정답에 들어 있어야 하는 핵심 사실]
${expect.map((e) => `- ${e}`).join("\n")}

[비서가 실제로 본 자료 (일부)]
${evidence || "(없음)"}

[비서의 답변]
${answer || "(빈 답변)"}

채점 기준:
- 2: 핵심 사실을 모두 담았고 틀린 내용이 없다. 표현이 달라도(예: "10시 반" = "10시 30분") 뜻이 같으면 인정한다.
- 1: 핵심 사실 일부만 담았거나, 맞는 내용에 사소한 오류가 섞였다.
- 0: 핵심 사실이 없거나, "찾지 못했습니다" 로 답했거나, 틀린 내용이 주가 된다.
- hallucination: [비서가 실제로 본 자료]에도 [핵심 사실]에도 없는 구체적 사실(날짜·이름·수치·결정)을 지어냈으면 true. 자료에 있는 날짜·이름을 옮긴 것은 환각이 아니다. 자료가 "(생략)" 이면 핵심 사실과 모순될 때만 true. "찾지 못했습니다" 는 false.

JSON 만 반환: {"score": 0|1|2, "hallucination": true|false, "reason": "한 줄"}`

  const r = await complete(JUDGE_MODEL, prompt, { temperature: 0, maxOutputTokens: 2048 })
  const m = r.text.match(/\{[\s\S]*\}/)
  let parsed: { score?: number; hallucination?: boolean; reason?: string } = {}
  try { parsed = m ? JSON.parse(m[0]) : {} } catch { /* 아래 기본값 */ }
  const score = parsed.score === 2 ? 2 : parsed.score === 1 ? 1 : 0
  return {
    score,
    hallucination: parsed.hallucination === true,
    reason: parsed.reason ?? `(심판 응답 해석 실패: ${r.text.slice(0, 80)})`,
    usage: r.usage,
    costUsd: costUsd(r.usage, JUDGE_MODEL.price),
    ms: r.ms,
  }
}

// 질문 파일 읽기 — run.ts(생성 평가)와 retrieval-eval.ts(검색 평가)가 같은 형식을 쓴다.
//
// 형식: { "ask": [{ "q": "질문", "expect": ["기대 문자열", …], …선택 필드 }] }
// 선택 필드는 질문 세트 v4 (mydocs/plans/2026-10-06-weknora-lab.md) 에서 온다. 없으면 기존 파일 그대로 읽힌다.
import { readFileSync } from "fs"

export interface GoldRef {
  /** EmbeddingChunk.source (OMNIS_CARD · TASK · WEEKLY_REPORT · CHAT_MESSAGE · IP_CASE) */
  source: string
  /** EmbeddingChunk.sourceId. CHAT_MESSAGE 는 메시지 ID */
  sourceId: string
}

export interface Question {
  id: string
  q: string
  expect: string[]
  /** 유형 (multi-hop · aggregate · stale · exact · unanswerable · ambiguous …). 없으면 보고서에서 "regression" */
  type?: string
  /** 정답 근거. 검색 지표(Recall · MRR · NDCG)의 기준 */
  gold?: GoldRef[]
  /** 답에 필요한 최소 도구 단계 수 */
  minSteps?: number
  /** 옛 결정을 가리키는 문자열 — 답에 나오면 stale 함정에 걸린 것 */
  stale?: string[]
  /** DB 에 없는 사실을 묻는 문항. "모른다"가 정답 */
  unanswerable?: boolean
  /** 출제 메모 — 무엇을 이어야 답이 되는지. 심판의 과정 점수에 준다 */
  note?: string
}

export const DEFAULT_TYPE = "regression"

export function loadQuestions(file: string): Question[] {
  // 문항에 id 가 있으면(v4: "v4-mh-01") 그대로, 없으면(옛 파일) 순번 A1, A2 …
  const raw = JSON.parse(readFileSync(file, "utf8")) as { ask: (Omit<Question, "id"> & { id?: string })[] }
  return raw.ask.map((a, i) => ({
    id: a.id ?? `A${i + 1}`, q: a.q, expect: a.expect ?? [],
    type: a.type, gold: a.gold, minSteps: a.minSteps, stale: a.stale, unanswerable: a.unanswerable, note: a.note,
  }))
}

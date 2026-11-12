// AI 활용 설문 — 한 질문에 범위 칸이 여럿일 때 시트 안에서 칸을 오가는 규칙(화면 없음). 시험: lib/ai-survey/steps.test.ts
//
// 작업지시자 2026-11-12: 슬라이더를 만져도 다음 칸으로 넘어가지 않는다. 시트 아래 「이전」 · 「다음」 으로 오가고,
// 마지막 칸에서는 「다음」 대신 「보내기」. 돌아가면 앞에서 고른 값이 그대로 보인다(값은 질문 단위 draft 에 남는다).
// 칸이 하나인 질문은 이 규칙을 쓰지 않는다 — 지금처럼 고르고 보낸다.

import type { Field, FieldAnswer, AnswerValues } from "./rules"

/** 이 칸은 폼으로 답이 찼나 */
export function isAnswered(f: Pick<Field, "kind">, a: FieldAnswer | undefined): boolean {
  if (!a) return false
  if ("unknown" in a) return true
  if ("choice" in a) return f.kind === "multi" ? a.choice.length >= 1 : a.choice.length === 1
  if ("num" in a) return Number.isFinite(a.num)
  return false
}

export interface StepNav {
  /** 지금 펼친 칸(0부터) — 칸 수 안으로 맞춘 값 */
  index: number
  total: number
  /** 「이전」 을 보인다 */
  prev: boolean
  /** 오른쪽 단추 — 마지막 칸이면 보내기 */
  action: "next" | "send"
  /** 오른쪽 단추를 누를 수 있나 — 다음: 이 칸을 골랐다 · 보내기: 모든 칸을 골랐다 */
  enabled: boolean
}

export function stepNav(fields: Pick<Field, "id" | "kind">[], values: AnswerValues, index: number): StepNav {
  const total = fields.length
  const i = Math.min(Math.max(index, 0), Math.max(total - 1, 0))
  const last = i >= total - 1
  const enabled = total > 0 && (last ? fields.every((f) => isAnswered(f, values[f.id])) : isAnswered(fields[i], values[fields[i].id]))
  return { index: i, total, prev: i > 0, action: last ? "send" : "next", enabled }
}

/** 질문을 새로 펼칠 때의 칸 — 말에서 읽은 값으로 맞춘 칸이 있으면 그 칸, 아니면 첫 칸 */
export function startStep(fields: Pick<Field, "id">[], focusFieldId?: string | null): number {
  const i = focusFieldId ? fields.findIndex((f) => f.id === focusFieldId) : -1
  return i >= 0 ? i : 0
}

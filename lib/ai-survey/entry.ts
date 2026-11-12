// AI 활용 설문 — 어디서 어떻게 들어가나, 여러 번 한 사람의 어느 응답을 세나. 순수(prisma 없음). 시험: lib/ai-survey/entry.test.ts
//
// 한 사람이 설문을 다시 할 수 있다(작업지시자 2026-11-11). 앞 응답은 지우지 않고 기록으로 남기되,
// 회사 집계에는 사람마다 「가장 최근에 제출한 1건」 만 쓴다 — 다시 하다 만 응답이 앞서 제출한 응답을 지우지 않게.

/** 마이 화면 카드의 말 — 아직 안 했으면 참여하기, 하다 말았으면 이어서 하기, 제출했으면 확인하기 */
export type SurveyEntry = "join" | "resume" | "view"

export const ENTRY_LABEL: Record<SurveyEntry, string> = { join: "설문 참여하기", resume: "설문 이어서 하기", view: "설문 확인하기" }

/** latest = 그 사람의 가장 최근 응답(없으면 null) */
export function surveyEntry(latest: { status: string } | null): SurveyEntry {
  if (!latest) return "join"
  return latest.status === "SUBMITTED" ? "view" : "resume"
}

/** 맨 위 안내 띠는 한 번도 제출하지 않은 사람에게만 — 다시 하는 중인 사람에게는 띄우지 않는다 */
export const bannerNeeded = (submittedCount: number): boolean => submittedCount === 0

/** 안내 띠를 닫으면 이 기기에서 7일 동안 숨긴다 */
export const SURVEY_BANNER_COOKIE = "omnis_survey_banner_dismissed"
export const SURVEY_BANNER_DAYS = 7
/** 설문 상태가 바뀌었다(제출 · 다시 하기) — 안내 띠가 다시 묻는다 */
export const SURVEY_CHANGED_EVENT = "omnis:survey-changed"

interface Rec {
  userId: string
  status: string
  createdAt: Date
}

export interface UserRecords<T> {
  /** 가장 최근 응답 — 지금 상태(답하는 중 · 확인 대기 · 제출) */
  current: T
  /** 집계에 쓰는 응답 — 가장 최근에 제출한 1건. 제출한 적이 없으면 null */
  counted: T | null
  /** 제출한 응답 수(기록) */
  submitted: number
}

/** 사람마다 응답을 묶는다 — 집계는 counted, 상태 표시는 current */
export function recordsByUser<T extends Rec>(rows: T[]): Map<string, UserRecords<T>> {
  const out = new Map<string, UserRecords<T>>()
  for (const r of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const cur = out.get(r.userId)
    const submitted = r.status === "SUBMITTED"
    out.set(r.userId, {
      current: r,
      counted: submitted ? r : cur?.counted ?? null,
      submitted: (cur?.submitted ?? 0) + (submitted ? 1 : 0),
    })
  }
  return out
}

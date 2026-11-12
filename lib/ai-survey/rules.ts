// AI 활용 설문 — 순수 규칙(prisma · 모델 없음). 시험: lib/ai-survey/rules.test.ts
//
// 정해진 문항은 없다. 대신 세 목적이 「채워졌다」 고 볼 칸(slot)만 정해 둔다 —
// 에이전트는 남은 칸 가운데 무엇을 어떤 말 · 어떤 보기로 물을지 정하고, 코드는 응답을 칸에 그대로 옮긴다.
// 그래서 충족도 · 끝낼 때 · 수치 지표는 모델이 아니라 코드가 정한다(같은 응답이면 같은 숫자).
//
// 입력은 두 갈래다(작업지시자 2026-11-11):
//   range — 범위 · 숫자 칸. 슬라이더 · 구간 칩 · 척도로만 답한다. 글로 받지 않는다(글에서 숫자를 읽어도 범위 입력으로 확정한다).
//   chat  — 나머지 칸. 입력창에 말로 답하고, 보기 칩은 추천 답이다. 말로 한 답은 모델이 칸 값으로 옮기되 값 목록은 코드가 검증한다.
// 계획: mydocs/plans/2026-11-11-ai-usage-survey.md

export const PURPOSES = ["usage", "tasks", "wishes"] as const
export type Purpose = (typeof PURPOSES)[number]
export const PURPOSE_LABEL: Record<Purpose, string> = { usage: "얼마나 쓰나", tasks: "어떤 작업", wishes: "바라는 것" }

export const TASK_KINDS = {
  short_qa: "짧은 질문",
  summarize: "문서 요약",
  write: "작성",
  translate: "번역",
  data: "데이터",
  code: "코딩 · 자동화",
  agent: "에이전트",
  other: "기타",
} as const
export type TaskKind = keyof typeof TASK_KINDS

export const WISH_TAGS = {
  write: "문서 · 메일 작성",
  summarize: "요약 · 정리",
  search: "사내 자료 찾기",
  automate: "반복 업무 자동화",
  data: "데이터 · 표 분석",
  translate: "번역",
  schedule: "일정 · 알림",
  code: "코딩",
  other: "기타",
} as const
export type WishTag = keyof typeof WISH_TAGS

export const PAYERS = { none: "유료로 쓰지 않음", company: "회사가 냄", personal: "내가 냄", both: "회사 · 개인 둘 다" } as const
export const LIMIT_HITS = { never: "없음", sometimes: "가끔", often: "자주" } as const
export const TASK_SIZES = { short: "한두 문장 주고받기", medium: "문서 한 건 정도", long: "여러 파일 · 긴 작업" } as const
/**
 * 가장 최근에 AI 에 맡긴 회사 일 하나(작업지시자 2026-11-12) — 「보통 어떤 일」 보다 기억에 덜 기대는 질문이다.
 * none(기억 안 남)은 「잘 모르겠음」 과 같이 뒤 질문(언제 · 주고받은 시간)을 걷는다. 「기타」 는 말로 쓴 글을 남긴다
 */
export const RECENT_TASKS = { write: "메일 초안", summarize: "문서 요약", data: "표 정리", translate: "번역", code: "코드", none: "기억 안 남", other: "기타" } as const

// ─── 지난주 ─────────────────────────────────────────────
// 사용 일수 · 사용량은 「평소」 가 아니라 「지난주(월~일)」 로 묻는다 — 평소를 물으면 좋은 주를 떠올려 부풀리기 쉽다.
// 날짜는 묻는 날(서울 기준)에서 계산해 질문 글 괄호에 넣는다. 질문이 저장될 때 글이 같이 저장되므로 나중에 봐도 그 주다.

const KST_MS = 9 * 3600_000
const DOW = ["일", "월", "화", "수", "목", "금", "토"]

/** 묻는 날 기준 지난주 월요일 · 일요일(서울 날짜, UTC 자정 Date 로) */
export function lastWeekRange(now: Date = new Date()): { start: Date; end: Date } {
  const kst = new Date(now.getTime() + KST_MS)
  const today = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate())
  const sinceMonday = (kst.getUTCDay() + 6) % 7
  const thisMonday = today - sinceMonday * 86_400_000
  return { start: new Date(thisMonday - 7 * 86_400_000), end: new Date(thisMonday - 86_400_000) }
}

/** 「11월 2일(월)~8일(일)」 — 달이 바뀌면 「10월 27일(월)~11월 2일(일)」 */
export function lastWeekLabel(now: Date = new Date()): string {
  const { start, end } = lastWeekRange(now)
  const day = (d: Date, withMonth: boolean) => `${withMonth ? `${d.getUTCMonth() + 1}월 ` : ""}${d.getUTCDate()}일(${DOW[d.getUTCDay()]})`
  return `${day(start, true)}~${day(end, start.getUTCMonth() !== end.getUTCMonth())}`
}

/** 지난주로 묻는 칸 */
export const LAST_WEEK_SLOTS: readonly string[] = ["daysPerWeek", "hoursPerDay", "sessionsPerDay"]

/** 질문 글에 지난주 날짜가 없으면 넣는다 — 모델이 빠뜨려도 응답자는 어느 주인지 안다 */
export function withLastWeek(question: string, week: string): string {
  if (question.includes(week)) return question
  if (question.includes("지난주")) return question.replace("지난주", `지난주(${week})`)
  return `${question} (지난주 ${week} 기준)`
}

export type FieldKind = "single" | "multi" | "slider" | "bucket" | "scale" | "text"
export type FieldMode = "range" | "chat"
/** 이 칸은 범위 입력으로 답하나, 말(과 추천 칩)로 답하나 */
export const fieldMode = (f: { kind: FieldKind }): FieldMode => (f.kind === "slider" || f.kind === "bucket" || f.kind === "scale" ? "range" : "chat")

interface Bucket {
  label: string
  /** 지표가 쓰는 대표값. 「그 이상」 구간이면 그 구간의 하한 */
  num: number
  /** 이 구간에 드는 가장 큰 수 — 글에서 읽은 숫자를 구간에 넣을 때 쓴다. 「그 이상」 구간에는 없다 */
  upTo?: number
  over?: true
}

type NumberInput =
  /** max 가 「그 이상」 끝값이면 overLabel — 그 자리를 고르면 하한으로 센다 */
  | { kind: "slider"; min: number; max: number; step: number; unit: string; overLabel?: string }
  | { kind: "bucket"; unit: string; buckets: readonly Bucket[] }

type SlotType =
  | { type: "number"; input: NumberInput }
  | { type: "enum"; values: Record<string, string> }
  | { type: "tags"; values: Record<string, string> }
  | { type: "labels"; defaults: readonly string[] }
  | { type: "free" }

interface SlotDef {
  purpose: Purpose | null
  /** 그 목적 안에서의 비중(합 100) */
  weight: number
  /** 모델에게 주는 한 줄 설명 */
  about: string
  shape: SlotType
}

// 범위의 근거는 omnis-reports/ai-usage-survey-261111/chat-style/v2-ranges.md 표에 있다. 고치면 그 표도 같이 고친다.
export const SLOTS = {
  // 주말에도 쓰는 사람이 있다 — 근무일(5)이 아니라 일주일(7)이 상한이다(작업지시자 2026-11-11)
  daysPerWeek: { purpose: "usage", weight: 30, about: "지난주(월~일) 회사 일에 AI 를 쓴 날 수(7일 중, 주말 포함)", shape: { type: "number", input: { kind: "slider", min: 0, max: 7, step: 1, unit: "일" } } },
  hoursPerDay: { purpose: "usage", weight: 25, about: "지난주 AI 를 쓴 날 하루에 AI 와 보낸 시간", shape: { type: "number", input: { kind: "slider", min: 0, max: 10, step: 0.5, unit: "시간", overLabel: "10시간 이상" } } },
  sessionsPerDay: {
    purpose: "usage", weight: 25, about: "지난주 AI 를 쓴 날 하루에 AI 에게 물은 횟수(hoursPerDay 대신 물어도 된다)",
    shape: {
      type: "number",
      input: {
        kind: "bucket", unit: "번",
        buckets: [
          { label: "1~2번", num: 2, upTo: 2 }, { label: "3~5번", num: 4, upTo: 5 }, { label: "6~10번", num: 8, upTo: 10 },
          { label: "11~30번", num: 20, upTo: 30 }, { label: "31~50번", num: 40, upTo: 50 }, { label: "50번 넘게", num: 50, over: true },
        ],
      },
    },
  },
  tools: { purpose: "usage", weight: 15, about: "쓰는 AI 도구", shape: { type: "labels", defaults: ["ChatGPT", "Claude", "Gemini", "Copilot", "옴니스"] } },
  payer: { purpose: "usage", weight: 10, about: "유료 구독 여부와 누가 내는지", shape: { type: "enum", values: PAYERS } },
  monthlyFeeKrw: {
    purpose: "usage", weight: 10, about: "유료 구독 월 금액 합계(원)",
    shape: {
      type: "number",
      input: {
        kind: "bucket", unit: "원",
        buckets: [
          { label: "3만원 미만", num: 15_000, upTo: 24_999 }, { label: "3만원쯤 (20달러 요금제 하나)", num: 30_000, upTo: 39_999 }, { label: "4~8만원", num: 60_000, upTo: 89_999 },
          { label: "9~20만원 (100달러 요금제)", num: 150_000, upTo: 209_999 }, { label: "21~40만원 (200달러 요금제)", num: 300_000, upTo: 400_000 }, { label: "40만원 넘게", num: 400_000, over: true },
        ],
      },
    },
  },
  limitHit: { purpose: "usage", weight: 10, about: "사용 한도에 걸려 본 경험", shape: { type: "enum", values: LIMIT_HITS } },
  taskKinds: { purpose: "tasks", weight: 40, about: "AI 로 하는 작업 종류(여러 개)", shape: { type: "tags", values: TASK_KINDS } },
  mainTask: { purpose: "tasks", weight: 20, about: "그중 가장 많이 하는 작업 하나", shape: { type: "enum", values: TASK_KINDS } },
  recentTask: { purpose: "tasks", weight: 15, about: "가장 최근에 AI 에 맡긴 회사 일 하나(보통이 아니라 가장 최근 것)", shape: { type: "enum", values: RECENT_TASKS } },
  /** 그 일이 언제였나 — 지난주 0일이라고 했는데 지난주였다면 앞뒤가 안 맞는다(metrics.ts consistencyFlags). num 은 몇 주 전 */
  recentWhen: {
    purpose: "tasks", weight: 0, about: "그 가장 최근 일이 언제였나",
    shape: { type: "number", input: { kind: "bucket", unit: "주 전", buckets: [{ label: "이번 주", num: 0, upTo: 0 }, { label: "지난주", num: 1, upTo: 1 }, { label: "그보다 전", num: 2, over: true }] } },
  },
  /** 그 일 하나에 AI 와 주고받은 시간(분) — 작업 크기 보정에 taskSize 보다 먼저 쓴다 */
  recentTime: {
    purpose: "tasks", weight: 10, about: "그 가장 최근 일 하나에 AI 와 주고받은 시간",
    shape: { type: "number", input: { kind: "bucket", unit: "분", buckets: [{ label: "5분 이내", num: 5, upTo: 5 }, { label: "5~30분", num: 15, upTo: 30 }, { label: "30분~1시간", num: 45, upTo: 60 }, { label: "1시간 넘게", num: 90, over: true }] } },
  },
  taskSize: { purpose: "tasks", weight: 15, about: "한 번 맡기는 작업의 보통 크기", shape: { type: "enum", values: TASK_SIZES } },
  wishes: { purpose: "wishes", weight: 60, about: "옴니스(사내 AI)가 해 주면 좋겠는 일(여러 개). 범용 AI 가 아니라 옴니스에 바라는 것이다", shape: { type: "tags", values: WISH_TAGS } },
  pain: { purpose: "wishes", weight: 40, about: "범용 AI(ChatGPT · Claude · Gemini 같은 것)를 쓰며 아쉬운 점(여러 개). 옴니스에 대한 것이 아니다", shape: { type: "labels", defaults: ["답이 부정확하다", "회사 자료를 모른다", "한도 · 비용이 부담된다", "쓰는 법을 잘 모르겠다", "보안이 걱정된다"] } },
  /** 칸에 넣지 않는 후속 질문 — 원문에만 남는다. 충족도에 들지 않고 3번까지 */
  free: { purpose: null, weight: 0, about: "위 칸에 들지 않는 짧은 후속 질문", shape: { type: "free" } },
} as const satisfies Record<string, SlotDef>

export type Slot = keyof typeof SLOTS
export const SLOT_NAMES = Object.keys(SLOTS) as Slot[]
export const MAX_FREE_TURNS = 3
/** 이만큼 물었으면 남은 칸이 있어도 마무리한다 — 끝나지 않는 설문을 막는다. 가장 최근 일 · 언제 · 주고받은 시간이 늘어 14 → 17 */
export const MAX_TURNS = 17
export const MAX_FIELDS = 3
/** 말로 한 답의 길이 */
export const SAY_MAX = 300
const LABEL_MAX = 60

export interface FieldOption {
  id: string
  label: string
  /** enum · tags 칸이면 그 값 */
  value?: string
  /** 구간 칩이면 대표값 · 그 구간에 드는 가장 큰 수 */
  num?: number
  upTo?: number
  over?: true
}

export interface Field {
  id: string
  slot: Slot
  kind: FieldKind
  /** 묶음일 때 칸 이름 */
  label?: string
  options?: FieldOption[]
  min?: number
  max?: number
  step?: number
  unit?: string
  /** 슬라이더 끝값이 「그 이상」 일 때 그 자리의 이름 */
  overLabel?: string
  /** 척도 양 끝 */
  minLabel?: string
  maxLabel?: string
}

export interface Ask {
  question: string
  fields: Field[]
}

/**
 * 한 칸의 응답. 「잘 모르겠음」 은 어느 칸에서나 고를 수 있다.
 * said 는 말로 한 답 — 서버가 만든다(화면이 보내는 것은 글뿐이다). labels 는 「…로 이해했어요」 에 보이는, 칸으로 옮긴 결과.
 */
export type FieldAnswer = { unknown: true } | { choice: string[] } | { num: number } | { said: string; values?: string[]; labels: string[]; others?: string[] }
export type AnswerValues = Record<string, FieldAnswer>

export interface Fact {
  /** 어느 응답에서 나왔나 */
  turnId: string
  unknown?: true
  num?: number
  /** 「그 이상」 끝값을 골랐다 — num 은 하한이다 */
  over?: true
  values?: string[]
  labels?: string[]
  /** tags 칸에서 「기타」 로 센 글 */
  others?: string[]
}
export type Facts = Partial<Record<Slot, Fact>>

export interface Turn {
  id: string
  ask: Ask
  answer?: AnswerValues
  askedAt: string
  answeredAt?: string
  /** 답을 고쳤다 — from 은 고치기 전 답(말풍선에 「앞 답 → 새 답 · 수정됨」) */
  edited?: { from: string; at: string }
  /** 이 질문을 만들 때 가장 최근에 답한 질문 — 후속 질문(free)의 근거 */
  basis?: string
  /** 근거가 된 답이 바뀌어 버린 후속 질문 */
  stale?: true
  /** 질문을 만든 쪽 — 모델이 못 만들면 준비된 질문(fallback) */
  source: "model" | "fallback"
  /** 서버에서 잰 시간(ms) — 요청을 받은 때부터 질문 첫 글자 · 폼 완성까지 */
  ms: { first: number | null; total: number }
  /** 화면에서 잰 시간(ms) — 누른 때부터 질문 첫 글자 · 폼이 보일 때까지 */
  clientMs?: { first: number; ready: number }
}

const filled = (facts: Facts, slot: Slot) => facts[slot] !== undefined
const num = (facts: Facts, slot: Slot) => (facts[slot]?.unknown ? undefined : facts[slot]?.num)

/** 지난주 0일이어도 묻는 칸 — 지난주에 안 썼어도 그 전에 맡긴 일은 있을 수 있고, 그 일이 지난주였다면 앞뒤가 안 맞는다 */
const ASKED_EVEN_IF_ZERO: readonly Slot[] = ["daysPerWeek", "recentTask", "recentWhen"]

/** 물을 필요가 없어진 칸 — 앞 답이 정한다 */
export function notApplicable(slot: Slot, facts: Facts): boolean {
  if (slot === "free") return true
  // 지난주 회사 일에 AI 를 안 썼다 → 사용량 · 작업은 더 묻지 않고(가장 최근 일과 그 때만) 바라는 것으로 간다
  if (num(facts, "daysPerWeek") === 0 && SLOTS[slot].purpose !== "wishes" && !ASKED_EVEN_IF_ZERO.includes(slot)) return true
  // 가장 최근 일을 모르면 그 일이 언제였는지 · 얼마나 주고받았는지도 묻지 않는다
  if (slot === "recentWhen" || slot === "recentTime") {
    const r = facts.recentTask
    return !!r && (r.unknown === true || r.values?.[0] === "none")
  }
  // 작업 크기는 가장 최근 일의 주고받은 시간으로 잰다 — 그걸 답했으면 「보통 크기」 는 묻지 않는다
  if (slot === "taskSize" && facts.recentTime && !facts.recentTime.unknown) return true
  if (slot === "hoursPerDay") return filled(facts, "sessionsPerDay")
  if (slot === "sessionsPerDay") return filled(facts, "hoursPerDay")
  if (slot === "monthlyFeeKrw") {
    const p = facts.payer
    return !!p && (p.unknown === true || p.values?.[0] === "none")
  }
  if (slot === "mainTask") {
    const k = facts.taskKinds
    return !!k && (k.unknown === true || (k.values?.length ?? 0) <= 1)
  }
  return false
}

/** 앞 칸의 답이 있어야 물을 수 있는 칸 */
const waitsFor: Partial<Record<Slot, Slot>> = { monthlyFeeKrw: "payer", mainTask: "taskKinds", recentWhen: "recentTask", recentTime: "recentTask", taskSize: "recentTask" }

/** 아직 물어야 하는 칸 — 지금 물을 수 있는 것만, 정의 순서대로 */
export function missingSlots(facts: Facts): Slot[] {
  return SLOT_NAMES.filter((s) => {
    if (filled(facts, s) || notApplicable(s, facts)) return false
    const dep = waitsFor[s]
    return !dep || filled(facts, dep)
  })
}

/** 남은 칸이 있나 — 앞 칸을 기다리는 칸도 센다 */
export function isComplete(facts: Facts): boolean {
  return SLOT_NAMES.every((s) => filled(facts, s) || notApplicable(s, facts))
}

/** 목적별 충족도(0~100). 채운 칸 · 물을 필요 없는 칸의 비중 합 */
export function coverage(facts: Facts): Record<Purpose, number> {
  const out = { usage: 0, tasks: 0, wishes: 0 }
  const total = { usage: 0, tasks: 0, wishes: 0 }
  for (const s of SLOT_NAMES) {
    const def = SLOTS[s]
    if (!def.purpose) continue
    // 시간 · 횟수는 둘 중 하나만 센다
    if (s === "sessionsPerDay") continue
    total[def.purpose] += def.weight
    // 횟수를 답했으면 notApplicable 이 시간 칸을 채운 것으로 본다
    if (filled(facts, s) || notApplicable(s, facts)) out[def.purpose] += def.weight
  }
  return { usage: Math.round((out.usage / total.usage) * 100), tasks: Math.round((out.tasks / total.tasks) * 100), wishes: Math.round((out.wishes / total.wishes) * 100) }
}

// ─── 질문 폼 ─────────────────────────────────────────────

/** 모델이 내는 모양(lib/ai-survey/prompt.ts 의 스키마와 같다) */
export interface RawAsk {
  question?: string | null
  fields?: (RawField | null | undefined)[] | null
}
export interface RawField {
  slot?: string | null
  kind?: string | null
  label?: string | null
  options?: ({ label?: string | null; value?: string | null } | null | undefined)[] | null
  min?: number | null
  max?: number | null
  step?: number | null
  unit?: string | null
}

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "")

function enumOptions(values: Record<string, string>, raw: RawField["options"], allow?: readonly string[]): FieldOption[] {
  const ok = (v: string) => v in values && (!allow || allow.includes(v))
  const seen = new Set<string>()
  const out: FieldOption[] = []
  for (const o of raw ?? []) {
    const value = clean(o?.value, 40)
    const label = clean(o?.label, 40)
    if (!label || !ok(value) || seen.has(value)) continue
    seen.add(value)
    out.push({ id: `o${out.length + 1}`, label, value })
  }
  if (out.length >= 2) return out
  // 모델 보기가 모자라면 준비된 보기
  return Object.entries(values).filter(([v]) => ok(v)).map(([value, label], i) => ({ id: `o${i + 1}`, label, value }))
}

function tagOptions(values: Record<string, string>, raw: RawField["options"]): FieldOption[] {
  const seen = new Set<string>()
  const out: FieldOption[] = []
  for (const o of raw ?? []) {
    const label = clean(o?.label, 40)
    const v = clean(o?.value, 40)
    if (!label || seen.has(label) || out.length >= 8) continue
    seen.add(label)
    // 「기타」 는 말로 받는다 — 칩으로 두지 않는다
    if (v === "other") continue
    out.push({ id: `o${out.length + 1}`, label, value: v in values ? v : "other" })
  }
  if (out.length >= 2) return out
  return Object.entries(values).filter(([v]) => v !== "other").map(([value, label], i) => ({ id: `o${i + 1}`, label, value }))
}

function labelOptions(defaults: readonly string[], raw: RawField["options"]): FieldOption[] {
  const labels = [...new Set((raw ?? []).map((o) => clean(o?.label, 40)).filter(Boolean))].slice(0, 8)
  return (labels.length >= 2 ? labels : [...defaults]).map((label, i) => ({ id: `o${i + 1}`, label }))
}

/** 칸 하나의 폼. 범위 · 구간 · 값 목록은 코드가 정하고 모델에게서는 말(보기 이름)만 받는다. 만들 수 없으면 null */
function buildField(id: string, slot: Slot, raw: RawField, facts: Facts, week: string): Field | null {
  const def = SLOTS[slot]
  const label = clean(raw.label, 30) || undefined
  const shape: SlotType = def.shape
  switch (shape.type) {
    case "number": {
      const i = shape.input
      if (i.kind === "slider") return { id, slot, kind: "slider", label, min: i.min, max: i.max, step: i.step, unit: i.unit, ...(i.overLabel ? { overLabel: i.overLabel } : {}) }
      // 「지난주」 칩에는 날짜를 붙인다 — 어느 주인지 응답자가 바로 안다
      const bucketLabel = (b: Bucket) => (slot === "recentWhen" && b.num === 1 ? `지난주(${week})` : b.label)
      return { id, slot, kind: "bucket", label, unit: i.unit, options: i.buckets.map((b: Bucket, n) => ({ id: `o${n + 1}`, label: bucketLabel(b), num: b.num, ...(b.upTo !== undefined ? { upTo: b.upTo } : {}), ...(b.over ? { over: true as const } : {}) })) }
    }
    case "enum": {
      // 가장 많이 하는 작업은 앞에서 고른 작업 안에서만
      const allow = slot === "mainTask" ? facts.taskKinds?.values : undefined
      const options = enumOptions(shape.values, raw.options, allow)
      return options.length >= 2 ? { id, slot, kind: "single", label, options } : null
    }
    case "tags":
      return { id, slot, kind: "multi", label, options: tagOptions(shape.values, raw.options) }
    case "labels":
      return { id, slot, kind: "multi", label, options: labelOptions(shape.defaults, raw.options) }
    case "free": {
      // 숫자를 글로 받지 않는다 — number 는 슬라이더로
      const kind = raw.kind === "number" ? "slider" : raw.kind
      if (kind === "single" || kind === "multi") {
        const options = labelOptions([], raw.options)
        return options.length >= 2 ? { id, slot, kind, label, options } : null
      }
      if (kind === "slider") {
        const min = Number(raw.min ?? 0)
        const max = Number(raw.max)
        if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || max - min > 1_000_000) return null
        const step = Number(raw.step)
        return { id, slot, kind, label, min, max, step: Number.isFinite(step) && step > 0 && step <= max - min ? step : 1, unit: clean(raw.unit, 8) || undefined }
      }
      if (kind === "scale") {
        const ends = (raw.options ?? []).map((o) => clean(o?.label, 20)).filter(Boolean)
        return { id, slot, kind, label, min: 1, max: 5, step: 1, minLabel: ends[0] ?? "전혀 아니다", maxLabel: ends[1] ?? "매우 그렇다" }
      }
      return kind === "text" ? { id, slot, kind: "text", label } : null
    }
  }
}

/** 지금까지 후속 질문(free)을 몇 번 했나 */
export const freeTurns = (turns: Pick<Turn, "ask">[]) => turns.filter((t) => t.ask.fields.some((f) => f.slot === "free")).length

/**
 * 모델이 낸 질문 → 화면에 그릴 폼. 이미 채운 칸 · 지금 물을 수 없는 칸 · 모르는 칸은 버린다.
 * 한 질문은 한 갈래다: 범위 칸끼리는 3개까지 묶고, 말로 답하는 칸은 하나만 묻는다(첫 칸의 갈래를 따른다).
 * 남는 칸이 없거나 질문 글이 비면 null — 부르는 쪽이 준비된 질문(fallbackAsk)을 쓴다.
 */
export function normalizeAsk(raw: RawAsk | null | undefined, facts: Facts, freeUsed = 0, now: Date = new Date()): Ask | null {
  const question = clean(raw?.question, 200)
  if (!question) return null
  const week = lastWeekLabel(now)
  const open = new Set<Slot>(missingSlots(facts))
  const fields: Field[] = []
  const used = new Set<Slot>()
  for (const rf of raw?.fields ?? []) {
    if (!rf || fields.length >= MAX_FIELDS) continue
    const slot = rf.slot as Slot
    if (!SLOT_NAMES.includes(slot) || used.has(slot)) continue
    if (slot === "free" ? freeUsed >= MAX_FREE_TURNS : !open.has(slot)) continue
    // 시간 · 횟수를 한 번에 둘 다 묻지 않는다
    if ((slot === "hoursPerDay" && used.has("sessionsPerDay")) || (slot === "sessionsPerDay" && used.has("hoursPerDay"))) continue
    const f = buildField(`f${fields.length + 1}`, slot, rf, facts, week)
    if (!f) continue
    if (fields.length > 0 && (fieldMode(fields[0]) === "chat" || fieldMode(f) === "chat")) continue
    used.add(slot)
    fields.push(f)
  }
  if (!fields.length) return null
  // 사용 일수 · 사용량은 지난주로 묻는다 — 모델이 날짜를 빠뜨려도 넣는다
  return { question: fields.some((f) => LAST_WEEK_SLOTS.includes(f.slot)) ? withLastWeek(question, week) : question, fields }
}

/** 준비된 질문 글. {week} 는 지난주 날짜 */
const FALLBACK_QUESTION: Record<Exclude<Slot, "free">, string> = {
  daysPerWeek: "지난주({week})에 회사 일로 AI 를 쓴 날은 며칠이에요? 주말도 넣어서요.",
  hoursPerDay: "지난주({week}) AI 를 쓴 날에는 하루에 얼마나 쓰셨어요?",
  sessionsPerDay: "지난주({week}) AI 를 쓴 날에는 하루에 몇 번쯤 물어보셨어요?",
  recentTask: "가장 최근에 AI 에 맡긴 회사 일 하나는 무엇이었나요?",
  recentWhen: "그 일은 언제였나요?",
  recentTime: "그 일 하나에 AI 와 주고받은 시간은 얼마쯤이었나요?",
  tools: "어떤 AI 도구를 쓰세요?",
  payer: "유료로 쓰는 AI 가 있나요? 있다면 누가 내나요?",
  monthlyFeeKrw: "유료 구독에 한 달에 얼마쯤 나가나요?",
  limitHit: "사용 한도에 걸려서 못 쓴 적이 있나요?",
  taskKinds: "AI 로 주로 어떤 일을 하세요?",
  mainTask: "그중 가장 많이 하는 일은 무엇인가요?",
  taskSize: "한 번에 맡기는 일은 보통 어느 정도 크기인가요?",
  wishes: "옴니스(사내 AI)가 해 주면 좋겠는 일은 무엇인가요?",
  // 여기서 AI 는 옴니스가 아니라 범용 AI 다 — 옴니스에 바라는 것은 wishes 가 따로 묻는다(작업지시자 2026-11-11)
  pain: "ChatGPT · Claude · Gemini 같은 범용 AI 를 쓰면서 아쉬운 점은 무엇인가요?",
}

const FALLBACK_OPTIONS: Partial<Record<Slot, { label: string; value: string }[]>> = {
  taskKinds: [
    { label: "짧은 질문 · 검색", value: "short_qa" },
    { label: "회의록 · 문서 요약", value: "summarize" },
    { label: "메일 · 보고서 초안", value: "write" },
    { label: "번역", value: "translate" },
    { label: "엑셀 · 데이터 정리", value: "data" },
    { label: "코딩 · 자동화", value: "code" },
    { label: "알아서 여러 단계 처리(에이전트)", value: "agent" },
  ],
  wishes: [
    { label: "메일 · 보고서 초안 써 주기", value: "write" },
    { label: "회의록 · 긴 문서 요약", value: "summarize" },
    { label: "사내 자료 찾아 주기", value: "search" },
    { label: "반복 업무 자동으로", value: "automate" },
    { label: "표 · 데이터 분석", value: "data" },
    { label: "번역", value: "translate" },
    { label: "일정 · 할 일 챙기기", value: "schedule" },
  ],
}

/** 준비된 질문 — 모델을 못 쓸 때(키 없음 · 예산 도달 · 오류 · 시험). 남은 칸 하나를 묻는다. 남은 칸이 없으면 null */
export function fallbackAsk(facts: Facts, now: Date = new Date()): Ask | null {
  const slot = missingSlots(facts)[0]
  if (!slot || slot === "free") return null
  const week = lastWeekLabel(now)
  const field = buildField("f1", slot, { options: FALLBACK_OPTIONS[slot] ?? null }, facts, week)
  return field ? { question: FALLBACK_QUESTION[slot].replace("{week}", week), fields: [field] } : null
}

// ─── 응답 ─────────────────────────────────────────────

/**
 * 화면이 폼으로 보낸 응답이 그 폼에 맞나. 맞지 않으면 까닭, 맞으면 null.
 * 글만 받는 칸(text)과 말로 한 답(said)은 여기로 오지 않는다 — 글은 서버가 칸으로 옮긴다(resolveSay).
 */
export function validateAnswer(ask: Ask, values: unknown): string | null {
  if (!values || typeof values !== "object" || Array.isArray(values)) return "응답 모양이 잘못됐습니다"
  const v = values as Record<string, unknown>
  for (const key of Object.keys(v)) if (!ask.fields.some((f) => f.id === key)) return "폼에 없는 칸입니다"
  for (const f of ask.fields) {
    const a = v[f.id] as Record<string, unknown> | undefined
    if (!a || typeof a !== "object") return "답하지 않은 칸이 있습니다"
    if (a.unknown === true) continue
    if (f.kind === "text") return "이 질문은 입력창에 말로 답해 주세요"
    if (f.kind === "single" || f.kind === "multi" || f.kind === "bucket") {
      const choice = a.choice
      if (!Array.isArray(choice) || choice.some((c) => typeof c !== "string") || choice.length === 0) return "보기를 골라 주세요"
      if (new Set(choice).size !== choice.length || choice.some((c) => !f.options?.some((o) => o.id === c))) return "폼에 없는 보기입니다"
      if (f.kind !== "multi" && choice.length !== 1) return "하나만 골라 주세요"
      continue
    }
    const n = a.num
    if (typeof n !== "number" || !Number.isFinite(n)) return "범위에서 골라 주세요"
    if (n < (f.min ?? 0) || n > (f.max ?? Number.MAX_SAFE_INTEGER)) return "범위를 벗어난 값입니다"
    if (f.kind === "scale" && !Number.isInteger(n)) return "1~5 중에서 골라 주세요"
  }
  return null
}

/** 응답을 칸에 옮긴다. validateAnswer 를 통과했거나 서버가 만든(said) 값만 넘긴다 */
export function applyAnswer(facts: Facts, ask: Ask, values: AnswerValues, turnId: string): Facts {
  const next: Facts = { ...facts }
  for (const f of ask.fields) {
    if (f.slot === "free") continue
    const a = values[f.id]
    if (!a) continue
    const shape: SlotType = SLOTS[f.slot].shape
    if ("unknown" in a) {
      next[f.slot] = { turnId, unknown: true }
    } else if ("choice" in a) {
      const picked = (f.options ?? []).filter((o) => a.choice.includes(o.id))
      const labels = picked.map((o) => o.label)
      if (shape.type === "number") {
        // 구간 칩 — 대표값. 「그 이상」 이면 하한
        const o = picked[0]
        if (o?.num !== undefined) next[f.slot] = { turnId, num: o.num, labels, ...(o.over ? { over: true as const } : {}) }
      } else if (shape.type === "labels") {
        next[f.slot] = { turnId, labels }
      } else {
        // 값 목록에 없던 보기 — 태그로는 「기타」 하나지만 글은 남긴다
        const others = shape.type === "tags" ? picked.filter((o) => (o.value ?? "other") === "other").map((o) => o.label) : []
        next[f.slot] = { turnId, labels, values: [...new Set(picked.map((o) => o.value ?? "other"))], ...(others.length ? { others } : {}) }
      }
    } else if ("num" in a) {
      next[f.slot] = { turnId, num: a.num, ...(f.overLabel && a.num >= (f.max ?? Infinity) ? { over: true as const } : {}) }
    } else if (shape.type === "labels") {
      next[f.slot] = { turnId, labels: a.labels }
    } else if (shape.type !== "number" && a.values?.length) {
      next[f.slot] = { turnId, labels: a.labels, values: a.values, ...(a.others?.length ? { others: a.others } : {}) }
    }
  }
  return next
}

/**
 * 앞 답이 바뀌어 뜻이 없어진 칸을 지운다 — 0일이면 사용량 · 작업(가장 최근 일 · 그 때는 남긴다), 유료가 아니면 금액,
 * 작업이 하나면(또는 고른 작업 밖이면) 가장 많이 하는 작업, 가장 최근 일을 모르면 그 때 · 주고받은 시간
 */
export function pruneFacts(facts: Facts): Facts {
  const next: Facts = { ...facts }
  if (num(next, "daysPerWeek") === 0) {
    for (const s of SLOT_NAMES) if (!ASKED_EVEN_IF_ZERO.includes(s) && (SLOTS[s].purpose === "usage" || SLOTS[s].purpose === "tasks")) delete next[s]
  }
  const r = next.recentTask
  if (r && (r.unknown || r.values?.[0] === "none")) {
    delete next.recentWhen
    delete next.recentTime
  }
  const p = next.payer
  if (p && (p.unknown || p.values?.[0] === "none")) delete next.monthlyFeeKrw
  const k = next.taskKinds
  const main = next.mainTask?.values?.[0]
  if (k && (k.unknown || (k.values?.length ?? 0) <= 1 || (main !== undefined && !k.values?.includes(main)))) delete next.mainTask
  return next
}

/** 지금의 답 전부 → 칸. 고친 답도 제자리에서 다시 옮기므로 순서와 무관하게 같은 결과가 나온다 */
export function factsOf(turns: Turn[]): Facts {
  let facts: Facts = {}
  for (const t of turns) if (t.answer) facts = applyAnswer(facts, t.ask, t.answer, t.id)
  return pruneFacts(facts)
}

/** 이 답은 더 쓰이지 않는다 — 앞 답이 바뀌어 칸에서 지워졌거나, 근거가 바뀐 후속 질문이다. 말풍선을 흐리게 그린다 */
export function turnDead(turn: Turn, facts: Facts): boolean {
  if (!turn.answer) return false
  const real = turn.ask.fields.filter((f) => f.slot !== "free")
  if (real.length === 0) return turn.stale === true
  return real.every((f) => facts[f.slot]?.turnId !== turn.id)
}

/** 묻던 질문이 아직 필요한가 — 고친 답 때문에 물을 필요가 없어졌으면 그 질문을 걷는다 */
export function pendingNeeded(turn: Turn, facts: Facts): boolean {
  const open = new Set<Slot>(missingSlots(facts))
  const real = turn.ask.fields.filter((f) => f.slot !== "free")
  return real.length === 0 ? turn.stale !== true : real.every((f) => open.has(f.slot))
}

/**
 * 지난 답 하나를 고친다 — 그 자리에서 답만 바꾼다(대화를 되돌리지 않는다).
 * 그 답을 근거로 물었던 후속 질문(free)은 버린다. 칸은 부르는 쪽이 factsOf 로 다시 만든다.
 * 없는 질문 · 아직 답하지 않은 질문이면 null.
 */
export function editTurn(turns: Turn[], turnId: string, answer: AnswerValues, at: string): Turn[] | null {
  const i = turns.findIndex((t) => t.id === turnId)
  const old = turns[i]
  if (!old?.answer) return null
  const before = old.ask.fields.map((f) => answerText(f, old.answer?.[f.id])).join(" / ")
  const after = old.ask.fields.map((f) => answerText(f, answer[f.id])).join(" / ")
  // 같은 답을 다시 고르면 고친 것이 아니다. 여러 번 고쳐도 「처음 답」 을 남긴다
  const edited = before === after ? old.edited : { from: old.edited?.from ?? before, at }
  return turns.map((t, n) => {
    if (n === i) return { ...t, answer, ...(edited ? { edited } : {}) }
    if (n > i && t.basis === turnId && t.ask.fields.some((f) => f.slot === "free")) return { ...t, stale: true as const }
    return t
  })
}

/** 응답 한 칸을 사람이 읽는 글로 — 내 말풍선 · 모델에게 주는 대화 기록 */
export function answerText(f: Field, a: FieldAnswer | undefined): string {
  if (!a) return ""
  if ("unknown" in a) return "잘 모르겠음"
  if ("choice" in a) return (f.options ?? []).filter((o) => a.choice.includes(o.id)).map((o) => o.label).join(", ")
  if ("num" in a) {
    if (f.kind === "scale") return `${a.num} / 5`
    return f.overLabel && a.num >= (f.max ?? Infinity) ? f.overLabel : `${a.num.toLocaleString("ko-KR")}${f.unit ?? ""}`
  }
  return a.said
}

/** 말로 한 답을 칸으로 옮긴 결과 — 「…로 이해했어요」. 말로 한 답이 아니거나 글 그대로면 빈 글 */
export function understoodText(a: FieldAnswer | undefined): string {
  if (!a || !("said" in a)) return ""
  const got = a.labels.join(", ")
  return got === a.said ? "" : got
}

// ─── 말로 한 답 ─────────────────────────────────────────────

/** 모델(또는 guessSay)이 글에서 읽어 낸 것. 값 목록 · 범위는 resolveSay 가 다시 검증한다 */
export interface RawSay {
  /** 어느 칸에 대한 말인가 */
  target?: string | null
  /** enum · tags 칸의 값 */
  values?: (string | null | undefined)[] | null
  /** 값 목록에 없는 것 · 이름 그대로 남길 것(도구 · 아쉬운 점) */
  labels?: (string | null | undefined)[] | null
  /** 범위 칸의 숫자 */
  num?: number | null
  unknown?: boolean | null
}

export type SayResult =
  /** 범위 칸 — 글로 확정하지 않는다. 화면이 그 질문의 범위 입력을 이 값으로 맞춰 띄운다 */
  | { kind: "range"; turnId: string; fieldId: string; num: number | null }
  | { kind: "set"; turnId: string; answer: AnswerValues }
  | { kind: "unclear"; reason: "no-target" | "not-asked" | "no-value" }

/** 범위 입력이 받을 수 있는 값으로 맞춘다 — 슬라이더는 눈금, 구간 칩은 그 수가 드는 구간의 대표값 */
export function snapNum(f: Field, n: number): number | null {
  if (!Number.isFinite(n)) return null
  if (f.kind === "bucket") {
    // 그 수가 드는 첫 구간. 어느 구간의 끝보다도 크면 마지막(그 이상) 구간
    const opts = (f.options ?? []).filter((o) => o.num !== undefined)
    if (opts.length === 0 || n < 0) return null
    return (opts.find((o) => o.upTo !== undefined && n <= o.upTo) ?? opts[opts.length - 1]).num!
  }
  const min = f.min ?? 0
  const max = f.max ?? min
  const step = f.step ?? 1
  const snapped = Math.round((Math.min(Math.max(n, min), max) - min) / step) * step + min
  return Math.round(snapped * 1000) / 1000
}

function saidAnswer(f: Field, raw: RawSay, text: string): FieldAnswer | null {
  if (raw.unknown === true) return { unknown: true }
  const said = clean(text, SAY_MAX)
  const shape: SlotType = SLOTS[f.slot].shape
  const labels = [...new Set((raw.labels ?? []).map((l) => clean(l, LABEL_MAX)).filter(Boolean))].slice(0, 6)
  const values = [...new Set((raw.values ?? []).map((v) => clean(v, 40)).filter(Boolean))]
  if (shape.type === "free") return said ? { said, labels: labels.length ? labels : [said] } : null
  if (shape.type === "labels") {
    const got = labels.length ? labels : said && said.length <= LABEL_MAX ? [said] : []
    return got.length ? { said, labels: got } : null
  }
  if (shape.type === "enum") {
    // 폼이 낸 보기 안에서만(가장 많이 하는 작업은 고른 작업 안에서만)
    const o = (f.options ?? []).find((x) => x.value !== undefined && values.includes(x.value))
    if (o && o.value !== "other") return { said, values: [o.value!], labels: [shape.values[o.value!] ?? o.label] }
    // 보기에 「기타」 가 있는 칸(가장 최근 일)은 보기에 없는 말을 글 그대로 「기타」 로 받는다
    const other = (f.options ?? []).find((x) => x.value === "other")
    const note = labels[0] ?? (said && said.length <= LABEL_MAX ? said : "")
    if (other && note) return { said, values: ["other"], labels: [note], others: [note] }
    return o ? { said, values: [o.value!], labels: [shape.values[o.value!] ?? o.label] } : null
  }
  if (shape.type === "tags") {
    const ok = values.filter((v) => v in shape.values && v !== "other")
    if (ok.length + labels.length === 0) return null
    return { said, values: [...ok, ...(labels.length ? ["other"] : [])], labels: [...ok.map((v) => shape.values[v]), ...labels], ...(labels.length ? { others: labels } : {}) }
  }
  return null
}

/**
 * 글에서 읽어 낸 것 → 무엇을 할지. 대상은 지금 묻는 질문이거나 이미 답한 질문이다(「아까 4일 아니고 3일」).
 * only 를 주면 그 질문만 본다(말풍선을 눌러 고치는 중).
 */
export function resolveSay(raw: RawSay | null | undefined, text: string, turns: Turn[], only?: string): SayResult {
  const scope = only ? turns.filter((t) => t.id === only) : turns
  const pending = scope.findLast((t) => !t.answer) ?? (only ? scope[0] : undefined)
  const target = SLOT_NAMES.includes(raw?.target as Slot) ? (raw!.target as Slot) : null
  // 가장 최근 것부터 — 같은 칸을 두 번 물었으면 뒤의 것이 지금의 답이다
  let hit: { turn: Turn; field: Field } | undefined
  if (target) {
    for (const t of [...scope].reverse()) {
      const f = t.ask.fields.find((x) => x.slot === target)
      if (f && !t.stale) {
        hit = { turn: t, field: f }
        break
      }
    }
  }
  // 대상을 못 짚었어도 지금 묻는 질문이 칸 하나면 그 답으로 본다
  if (!hit && pending && pending.ask.fields.length === 1 && (!target || only)) hit = { turn: pending, field: pending.ask.fields[0] }
  if (!hit) return { kind: "unclear", reason: target ? "not-asked" : "no-target" }
  const { turn, field } = hit
  if (fieldMode(field) === "range") {
    return { kind: "range", turnId: turn.id, fieldId: field.id, num: typeof raw?.num === "number" ? snapNum(field, raw.num) : null }
  }
  const a = saidAnswer(field, raw ?? {}, text)
  if (!a) return { kind: "unclear", reason: "no-value" }
  return { kind: "set", turnId: turn.id, answer: { ...(turn.answer ?? {}), [field.id]: a } }
}

const norm = (s: string) => s.toLowerCase().replace(/[\s·.,/()~]+/g, "")

/**
 * 모델 없이 글을 읽는다 — 키 없음 · 비용 상한 · 오류 · 시험. 숫자 + 단위는 그 범위 칸으로,
 * 그 밖에는 지금 묻는 질문의 보기 이름이 글에 들어 있는지 본다. 모델만큼 알아듣지는 못한다.
 */
export function guessSay(text: string, turns: Turn[], only?: string): RawSay {
  const scope = only ? turns.filter((t) => t.id === only) : turns
  if (/모르겠|몰라|글쎄/.test(text)) {
    const p = scope.findLast((t) => !t.answer) ?? scope[0]
    return { target: p?.ask.fields[0]?.slot ?? null, unknown: true }
  }
  const asked = (slot: Slot) => scope.some((t) => t.ask.fields.some((f) => f.slot === slot))
  const last = (re: RegExp) => {
    const m = [...text.matchAll(re)].at(-1)
    return m ? Number(m[1].replace(/,/g, "")) : null
  }
  const units: [Slot, number | null][] = [
    ["monthlyFeeKrw", (() => { const man = last(/(\d[\d,.]*)\s*만\s*원?/g); return man !== null ? man * 10_000 : last(/(\d[\d,]*)\s*원/g) })()],
    ["hoursPerDay", last(/(\d+(?:\.\d+)?)\s*시간/g)],
    ["sessionsPerDay", last(/(\d+)\s*(?:번|회)/g)],
    ["daysPerWeek", /매일/.test(text) ? 7 : last(/(\d+)\s*일/g)],
  ]
  for (const [slot, n] of units) if (n !== null && asked(slot)) return { target: slot, num: n }
  const p = scope.findLast((t) => !t.answer) ?? (only ? scope[0] : undefined)
  const f = p?.ask.fields.length === 1 ? p.ask.fields[0] : undefined
  if (!f) return { target: null }
  const t = norm(text)
  const picked = (f.options ?? []).filter((o) => norm(o.label).length >= 2 && t.includes(norm(o.label)))
  const shape: SlotType = SLOTS[f.slot].shape
  if (shape.type === "enum" || shape.type === "tags") {
    const byName = Object.entries(shape.values).filter(([v, name]) => v !== "other" && t.includes(norm(name))).map(([v]) => v)
    const values = [...new Set([...picked.map((o) => o.value).filter((v): v is string => !!v && v !== "other"), ...byName])]
    // 보기에 없는 말은 글 그대로 「기타」 로
    return { target: f.slot, values, labels: shape.type === "tags" && values.length === 0 ? [text] : [] }
  }
  return { target: f.slot, labels: picked.length ? picked.map((o) => o.label) : [text] }
}

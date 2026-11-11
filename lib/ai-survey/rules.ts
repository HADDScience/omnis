// AI 활용 설문 — 순수 규칙(prisma · 모델 없음). 시험: lib/ai-survey/rules.test.ts
//
// 정해진 문항은 없다. 대신 세 목적이 「채워졌다」 고 볼 칸(slot)만 정해 둔다 —
// 에이전트는 남은 칸 가운데 무엇을 어떤 말 · 어떤 보기로 물을지 정하고, 코드는 폼 응답을 칸에 그대로 옮긴다.
// 그래서 충족도 · 끝낼 때 · 수치 지표는 모델이 아니라 코드가 정한다(같은 응답이면 같은 숫자).
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

export type FieldKind = "single" | "multi" | "slider" | "number" | "scale" | "text"
const FIELD_KINDS: readonly FieldKind[] = ["single", "multi", "slider", "number", "scale", "text"]

type SlotType =
  | { type: "number"; kind: "slider" | "number"; min: number; max: number; step: number; unit: string }
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

export const SLOTS = {
  daysPerWeek: { purpose: "usage", weight: 30, about: "회사 일에 AI 를 쓰는 날 수(주 5일 중)", shape: { type: "number", kind: "slider", min: 0, max: 5, step: 1, unit: "일" } },
  hoursPerDay: { purpose: "usage", weight: 25, about: "쓰는 날 하루에 AI 와 보내는 시간", shape: { type: "number", kind: "slider", min: 0, max: 8, step: 0.5, unit: "시간" } },
  sessionsPerDay: { purpose: "usage", weight: 25, about: "쓰는 날 하루에 AI 에게 묻는 횟수(hoursPerDay 대신 물어도 된다)", shape: { type: "number", kind: "number", min: 0, max: 200, step: 1, unit: "번" } },
  tools: { purpose: "usage", weight: 15, about: "쓰는 AI 도구", shape: { type: "labels", defaults: ["ChatGPT", "Claude", "Gemini", "Copilot", "옴니스"] } },
  payer: { purpose: "usage", weight: 10, about: "유료 구독 여부와 누가 내는지", shape: { type: "enum", values: PAYERS } },
  monthlyFeeKrw: { purpose: "usage", weight: 10, about: "유료 구독 월 금액 합계(원)", shape: { type: "number", kind: "number", min: 0, max: 1_000_000, step: 1000, unit: "원" } },
  limitHit: { purpose: "usage", weight: 10, about: "사용 한도에 걸려 본 경험", shape: { type: "enum", values: LIMIT_HITS } },
  taskKinds: { purpose: "tasks", weight: 50, about: "AI 로 하는 작업 종류(여러 개)", shape: { type: "tags", values: TASK_KINDS } },
  mainTask: { purpose: "tasks", weight: 25, about: "그중 가장 많이 하는 작업 하나", shape: { type: "enum", values: TASK_KINDS } },
  taskSize: { purpose: "tasks", weight: 25, about: "한 번 맡기는 작업의 보통 크기", shape: { type: "enum", values: TASK_SIZES } },
  wishes: { purpose: "wishes", weight: 60, about: "옴니스(사내 AI)가 해 주면 좋겠는 일(여러 개). 범용 AI 가 아니라 옴니스에 바라는 것이다", shape: { type: "tags", values: WISH_TAGS } },
  pain: { purpose: "wishes", weight: 40, about: "범용 AI(ChatGPT · Claude · Gemini 같은 것)를 쓰며 아쉬운 점(여러 개). 옴니스에 대한 것이 아니다", shape: { type: "labels", defaults: ["답이 부정확하다", "회사 자료를 모른다", "한도 · 비용이 부담된다", "쓰는 법을 잘 모르겠다", "보안이 걱정된다"] } },
  /** 칸에 넣지 않는 후속 질문 — 원문에만 남는다. 충족도에 들지 않고 3번까지 */
  free: { purpose: null, weight: 0, about: "위 칸에 들지 않는 짧은 후속 질문", shape: { type: "free" } },
} as const satisfies Record<string, SlotDef>

export type Slot = keyof typeof SLOTS
export const SLOT_NAMES = Object.keys(SLOTS) as Slot[]
export const MAX_FREE_TURNS = 3
/** 이만큼 물었으면 남은 칸이 있어도 마무리한다 — 끝나지 않는 설문을 막는다 */
export const MAX_TURNS = 14
export const MAX_FIELDS = 3
export const OTHER_MAX = 80
export const TEXT_MAX = 120

export interface FieldOption {
  id: string
  label: string
  /** enum · tags 칸이면 그 값 */
  value?: string
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
  /** 「기타」 한 줄 */
  allowOther?: boolean
  /** 척도 양 끝 */
  minLabel?: string
  maxLabel?: string
}

export interface Ask {
  question: string
  fields: Field[]
}

/** 「잘 모르겠음」 은 어느 칸에서나 고를 수 있다 */
export type FieldAnswer = { unknown: true } | { choice: string[]; other?: string } | { num: number } | { text: string }
export type AnswerValues = Record<string, FieldAnswer>

export interface Fact {
  /** 어느 응답에서 나왔나 */
  turnId: string
  unknown?: true
  num?: number
  values?: string[]
  labels?: string[]
  /** tags 칸에서 「기타」 로 센 글 */
  others?: string[]
  text?: string
}
export type Facts = Partial<Record<Slot, Fact>>

export interface Turn {
  id: string
  ask: Ask
  answer?: AnswerValues
  askedAt: string
  answeredAt?: string
  /** 질문을 만든 쪽 — 모델이 못 만들면 준비된 질문(fallback) */
  source: "model" | "fallback"
  /** 서버에서 잰 시간(ms) — 요청을 받은 때부터 질문 첫 글자 · 폼 완성까지 */
  ms: { first: number | null; total: number }
  /** 화면에서 잰 시간(ms) — 누른 때부터 질문 첫 글자 · 폼이 보일 때까지 */
  clientMs?: { first: number; ready: number }
}

const filled = (facts: Facts, slot: Slot) => facts[slot] !== undefined
const num = (facts: Facts, slot: Slot) => (facts[slot]?.unknown ? undefined : facts[slot]?.num)

/** 물을 필요가 없어진 칸 — 앞 답이 정한다 */
export function notApplicable(slot: Slot, facts: Facts): boolean {
  if (slot === "free") return true
  // 회사 일에 AI 를 안 쓴다 → 사용량 · 작업은 더 묻지 않고 바라는 것으로 간다
  if (num(facts, "daysPerWeek") === 0 && SLOTS[slot].purpose !== "wishes" && slot !== "daysPerWeek") return true
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
const waitsFor: Partial<Record<Slot, Slot>> = { monthlyFeeKrw: "payer", mainTask: "taskKinds" }

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
    // 「기타」 는 폼이 따로 한 줄로 받는다
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

/** 칸 하나의 폼. 범위 · 값 목록은 코드가 정하고 모델에게서는 말(보기 이름)만 받는다. 만들 수 없으면 null */
function buildField(id: string, slot: Slot, raw: RawField, facts: Facts): Field | null {
  const def = SLOTS[slot]
  const label = clean(raw.label, 30) || undefined
  const shape: SlotType = def.shape
  switch (shape.type) {
    case "number":
      return { id, slot, kind: raw.kind === "slider" || raw.kind === "number" ? raw.kind : shape.kind, label, min: shape.min, max: shape.max, step: shape.step, unit: shape.unit }
    case "enum": {
      // 가장 많이 하는 작업은 앞에서 고른 작업 안에서만
      const allow = slot === "mainTask" ? facts.taskKinds?.values : undefined
      const options = enumOptions(shape.values, raw.options, allow)
      return options.length >= 2 ? { id, slot, kind: "single", label, options } : null
    }
    case "tags":
      return { id, slot, kind: "multi", label, options: tagOptions(shape.values, raw.options), allowOther: true }
    case "labels":
      return { id, slot, kind: "multi", label, options: labelOptions(shape.defaults, raw.options), allowOther: true }
    case "free": {
      const kind = FIELD_KINDS.includes(raw.kind as FieldKind) ? (raw.kind as FieldKind) : null
      if (!kind) return null
      if (kind === "single" || kind === "multi") {
        const options = labelOptions([], raw.options)
        return options.length >= 2 ? { id, slot, kind, label, options, allowOther: true } : null
      }
      if (kind === "slider" || kind === "number") {
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
      return { id, slot, kind: "text", label }
    }
  }
}

/** 지금까지 후속 질문(free)을 몇 번 했나 */
export const freeTurns = (turns: Pick<Turn, "ask">[]) => turns.filter((t) => t.ask.fields.some((f) => f.slot === "free")).length

/**
 * 모델이 낸 질문 → 화면에 그릴 폼. 이미 채운 칸 · 지금 물을 수 없는 칸 · 모르는 칸은 버린다.
 * 남는 칸이 없거나 질문 글이 비면 null — 부르는 쪽이 준비된 질문(fallbackAsk)을 쓴다.
 */
export function normalizeAsk(raw: RawAsk | null | undefined, facts: Facts, freeUsed = 0): Ask | null {
  const question = clean(raw?.question, 200)
  if (!question) return null
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
    const f = buildField(`f${fields.length + 1}`, slot, rf, facts)
    if (!f) continue
    used.add(slot)
    fields.push(f)
  }
  // 후속 질문만으로는 설문이 나아가지 않는다 — 칸이 남았으면 칸을 하나는 물어야 한다
  if (fields.length === 0 || (open.size > 0 && fields.every((f) => f.slot === "free"))) return null
  return { question, fields }
}

const FALLBACK_QUESTION: Record<Exclude<Slot, "free">, string> = {
  daysPerWeek: "회사 일을 하면서 AI 를 일주일에 며칠 쓰세요?",
  hoursPerDay: "쓰는 날에는 하루에 얼마나 쓰세요?",
  sessionsPerDay: "쓰는 날에는 하루에 몇 번쯤 물어보세요?",
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
export function fallbackAsk(facts: Facts): Ask | null {
  const slot = missingSlots(facts)[0]
  if (!slot || slot === "free") return null
  const field = buildField("f1", slot, { options: FALLBACK_OPTIONS[slot] ?? null }, facts)
  return field ? { question: FALLBACK_QUESTION[slot], fields: [field] } : null
}

// ─── 응답 ─────────────────────────────────────────────

/** 폼에 맞지 않는 응답이면 까닭, 맞으면 null */
export function validateAnswer(ask: Ask, values: unknown): string | null {
  if (!values || typeof values !== "object" || Array.isArray(values)) return "응답 모양이 잘못됐습니다"
  const v = values as Record<string, unknown>
  for (const key of Object.keys(v)) if (!ask.fields.some((f) => f.id === key)) return "폼에 없는 칸입니다"
  for (const f of ask.fields) {
    const a = v[f.id] as Record<string, unknown> | undefined
    if (!a || typeof a !== "object") return "답하지 않은 칸이 있습니다"
    if (a.unknown === true) continue
    if (f.kind === "single" || f.kind === "multi") {
      const choice = a.choice
      if (!Array.isArray(choice) || choice.some((c) => typeof c !== "string")) return "보기를 골라 주세요"
      if (new Set(choice).size !== choice.length || choice.some((c) => !f.options?.some((o) => o.id === c))) return "폼에 없는 보기입니다"
      const other = a.other === undefined ? "" : typeof a.other === "string" ? a.other.trim() : null
      if (other === null || other.length > OTHER_MAX) return `기타는 ${OTHER_MAX}자까지입니다`
      if (other && !f.allowOther) return "이 칸은 기타를 받지 않습니다"
      const picked = choice.length + (other ? 1 : 0)
      if (picked === 0) return "보기를 골라 주세요"
      if (f.kind === "single" && picked !== 1) return "하나만 골라 주세요"
      continue
    }
    if (f.kind === "text") {
      if (typeof a.text !== "string" || !a.text.trim()) return "내용을 적어 주세요"
      if (a.text.trim().length > TEXT_MAX) return `${TEXT_MAX}자까지입니다`
      continue
    }
    const n = a.num
    if (typeof n !== "number" || !Number.isFinite(n)) return "숫자를 넣어 주세요"
    if (n < (f.min ?? 0) || n > (f.max ?? Number.MAX_SAFE_INTEGER)) return "범위를 벗어난 값입니다"
    if (f.kind === "scale" && !Number.isInteger(n)) return "1~5 중에서 골라 주세요"
  }
  return null
}

/** 폼 응답을 칸에 옮긴다. validateAnswer 를 통과한 값만 넘긴다 */
export function applyAnswer(facts: Facts, ask: Ask, values: AnswerValues, turnId: string): Facts {
  const next: Facts = { ...facts }
  for (const f of ask.fields) {
    if (f.slot === "free") continue
    const a = values[f.id]
    if (!a) continue
    if ("unknown" in a) {
      next[f.slot] = { turnId, unknown: true }
    } else if ("choice" in a) {
      const picked = (f.options ?? []).filter((o) => a.choice.includes(o.id))
      const other = a.other?.trim()
      const labels = [...picked.map((o) => o.label), ...(other ? [other] : [])]
      const shape: SlotType = SLOTS[f.slot].shape
      const values2 = shape.type === "labels" ? undefined : [...new Set([...picked.map((o) => o.value ?? "other"), ...(other ? ["other"] : [])])]
      // 값 목록에 없던 보기 · 직접 적은 글 — 태그로는 「기타」 하나지만 글은 남긴다
      const others = shape.type === "tags" ? [...picked.filter((o) => (o.value ?? "other") === "other").map((o) => o.label), ...(other ? [other] : [])] : []
      next[f.slot] = { turnId, labels, ...(values2 ? { values: values2 } : {}), ...(others.length ? { others } : {}) }
    } else if ("num" in a) {
      next[f.slot] = { turnId, num: a.num }
    } else {
      next[f.slot] = { turnId, text: a.text.trim() }
    }
  }
  return next
}

/** 응답 한 칸을 사람이 읽는 글로 — 지난 답 목록 · 모델에게 주는 대화 기록 */
export function answerText(f: Field, a: FieldAnswer | undefined): string {
  if (!a) return ""
  if ("unknown" in a) return "잘 모르겠음"
  if ("choice" in a) return [...(f.options ?? []).filter((o) => a.choice.includes(o.id)).map((o) => o.label), ...(a.other?.trim() ? [a.other.trim()] : [])].join(", ")
  if ("num" in a) return f.kind === "scale" ? `${a.num} / 5` : `${a.num.toLocaleString("ko-KR")}${f.unit ?? ""}`
  return a.text
}

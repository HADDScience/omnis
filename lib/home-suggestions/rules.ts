// 첫 화면 「지금 할 일」 제안 — 규칙(순수 함수, DB · 네트워크 없음). 시험: lib/home-suggestions/rules.test.ts
//
// 정책(2026-11-27 사용자 결정, ~/work/omnis-reports/home-suggestions-policy-261127.md):
// 1. 후보는 첫 화면을 열 때마다 코드로 모은다(AI 없음).
// 2. AI(옴니스 기본 모델)로 순서 · 한 줄을 만드는 때는 둘뿐이다 — 그 사람의 하루 첫 접속(서울 날짜), 후보 집합이 바뀌었을 때.
//    같은 사람에게 30분 안에는 다시 만들지 않는다. 바뀐 게 없으면 저장된 결과를 그대로 보인다.
// 3. 한도: 사람당 하루 6회, 회사 하루 50회. 넘거나 AI 가 실패하면 코드 순서(마감 가까운 순)로 보인다.
// 4. 만들 때마다 trigger · 후보 수 · 비용을 남기고(AiUsage feature "homeSuggestions"), 카드 노출 · 클릭을 trigger 와 함께 남긴다.

export const HOME_SUGGESTIONS_FEATURE = "homeSuggestions"
export const COOLDOWN_MS = 30 * 60_000
export const USER_DAILY_AI = 6
export const COMPANY_DAILY_AI = 50
/** 첫 화면에 보이는 카드 수 */
export const SHOW = 4
/** 나를 부른 글은 며칠 안의 것만 */
export const MENTION_DAYS = 3
/** 우리 결정 과제 마감은 며칠 안의 것만 */
export const GRANT_DAYS = 7
/** 새 지원서는 며칠 안에 들어온 것만 */
export const APPLICATION_DAYS = 7
/** 본문에서 내 이름을 부른 글은 며칠 안의 것만 */
export const NAME_CALL_DAYS = 3
/** 참여 중인 업무 — 며칠 안에 내가 글을 몇 개 이상 남긴 업무 */
export const PARTICIPATION_DAYS = 14
export const PARTICIPATION_MIN_MESSAGES = 2

export type CandidateKind = "approval" | "task_due" | "participating_task" | "mention" | "name_call" | "grant_due" | "applications"
/** 후보가 없을 때 보이는 쉬어 가는 카드 — AI 를 부르지 않는다 */
export type ItemKind = CandidateKind | "rest"
export type Trigger = "first_visit" | "candidates_changed"
export type SuggestionAction = { type: "link"; href: string } | { type: "ask"; prompt: string }

export interface Candidate {
  /** 종류:대상 id — 해시 · 노출 기록의 열쇠 */
  key: string
  kind: CandidateKind
  /** 대상 이름(업무 이름 · 과제 이름 · 보낸 사람 …) */
  title: string
  /** AI 에 함께 주는 짧은 맥락(글 앞부분 · 공고명 …) */
  detail: string
  /** 마감(ISO). 없으면 null */
  due: string | null
  /** 생긴 때(ISO) — 마감이 없는 후보의 순서 */
  at: string
  action: SuggestionAction
}

export interface SuggestionItem {
  key: string
  kind: ItemKind
  title: string
  /** 카드에 보이는 한 줄 */
  line: string
  action: SuggestionAction
  due: string | null
}

// ── 날짜 ────────────────────────────────────────────────

/** 서울 날짜 YYYY-MM-DD */
export const seoulDay = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10)

/** 서울 날짜 기준 며칠 뒤인가(오늘 0, 내일 1, 지났으면 음수) */
export function daysUntil(dueIso: string, now: Date): number {
  const a = Date.parse(`${seoulDay(new Date(dueIso))}T00:00:00Z`)
  const b = Date.parse(`${seoulDay(now)}T00:00:00Z`)
  return Math.round((a - b) / 86_400_000)
}

export function dueWord(dueIso: string | null, now: Date): string {
  if (!dueIso) return ""
  const n = daysUntil(dueIso, now)
  if (n < 0) return `마감 ${-n}일 지남`
  if (n === 0) return "오늘 마감"
  if (n === 1) return "내일 마감"
  return `${n}일 뒤 마감`
}

// ── 후보 집합 · 코드 순서 ──────────────────────────────

/** 후보 집합의 해시 — 열쇠만 본다(제목 · 글 내용이 바뀌어도 같은 일이면 같다) */
export function candidateHash(cs: Candidate[]): string {
  // 화면 코드도 이 파일을 읽어 node:crypto 를 쓰지 않는다 — FNV-1a 두 갈래(32비트 × 2)
  const text = [...new Set(cs.map((c) => c.key))].sort().join("\n")
  let a = 0x811c9dc5, b = 0x01000193 ^ text.length
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    a = Math.imul(a ^ ch, 0x01000193) >>> 0
    b = Math.imul(b ^ ch, 0x5bd1e995) >>> 0
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")
}

const KIND_RANK: Record<CandidateKind, number> = { approval: 0, task_due: 1, participating_task: 2, grant_due: 3, mention: 4, name_call: 5, applications: 6 }

/** 코드 순서 — 마감 가까운 순. 마감이 없으면 그 뒤에 종류 · 최근 순 */
export function codeOrder(cs: Candidate[]): Candidate[] {
  return [...cs].sort((a, b) => {
    if (a.due && b.due) return Date.parse(a.due) - Date.parse(b.due) || KIND_RANK[a.kind] - KIND_RANK[b.kind]
    if (a.due) return -1
    if (b.due) return 1
    return KIND_RANK[a.kind] - KIND_RANK[b.kind] || Date.parse(b.at) - Date.parse(a.at)
  })
}

/** AI 를 쓰지 않을 때의 한 줄 */
export function codeLine(c: Candidate, now: Date): string {
  const due = dueWord(c.due, now)
  switch (c.kind) {
    case "approval":
      return `「${c.title}」 ${c.detail}${due ? ` · ${due}` : ""}`
    case "task_due":
      return `「${c.title}」 ${due}`
    case "participating_task":
      return `「${c.title}」 ${due} · 담당 아님 · 최근 글 남김`
    case "grant_due":
      return `「${c.title}」 ${due} — 준비 상황 정리`
    case "mention":
      return `${c.title}님이 부른 글에 답하기`
    case "name_call": {
      const follow = c.detail.startsWith(FOLLOW_UP)
      const body = follow ? c.detail.slice(FOLLOW_UP.length).trim() : c.detail
      return `${c.title}님이 ${follow ? "내 글에 이어 쓴" : "이름을 부른"} 글 — ${body.slice(0, 24)}${body.length > 24 ? "…" : ""}`
    }
    case "applications":
      return c.title
  }
}

export function toItems(ordered: Candidate[], now: Date, lines?: Map<string, string>): SuggestionItem[] {
  return ordered.slice(0, SHOW).map((c) => ({
    key: c.key, kind: c.kind, title: c.title, due: c.due, action: c.action,
    line: lines?.get(c.key) || codeLine(c, now),
  }))
}

// ── 언제 AI 를 부르나 ─────────────────────────────────

export interface RunLite {
  id: string
  day: string
  source: "ai" | "code"
  trigger: string
  candidateHash: string
  createdAt: Date
}

export type Decision =
  | { kind: "empty" }
  | { kind: "reuse"; run: RunLite }
  | { kind: "ai"; trigger: Trigger }
  | { kind: "code"; trigger: Trigger; reason: "cooldown" | "user_limit" | "company_limit" }

/**
 * lastAi: 이 사람의 가장 최근 AI 성공 실행(날짜 무관), lastAttempt: 가장 최근 AI 를 부른 실행(실패 포함),
 * lastAny: 가장 최근 실행(AI · 코드). userAiToday · companyAiToday: 오늘(서울) AI 를 부른 수(실패 포함).
 * 30분 간격과 하루 한도는 「부른 것」 으로 센다 — 실패한 뒤 열 때마다 다시 부르지 않게.
 */
export function decide(args: {
  now: Date; hash: string; count: number
  lastAi: RunLite | null; lastAttempt?: RunLite | null; lastAny: RunLite | null
  userAiToday: number; companyAiToday: number
}): Decision {
  const { now, hash, lastAi, lastAny } = args
  const lastAttempt = args.lastAttempt ?? lastAi
  if (args.count === 0) return { kind: "empty" }
  const today = seoulDay(now)
  const aiToday = lastAi && lastAi.day === today ? lastAi : null
  const trigger: Trigger | null = !aiToday ? "first_visit" : aiToday.candidateHash !== hash ? "candidates_changed" : null
  if (!trigger) return { kind: "reuse", run: aiToday! }
  const reason = lastAttempt && now.getTime() - lastAttempt.createdAt.getTime() < COOLDOWN_MS ? "cooldown"
    : args.userAiToday >= USER_DAILY_AI ? "user_limit"
    : args.companyAiToday >= COMPANY_DAILY_AI ? "company_limit"
    : null
  if (!reason) return { kind: "ai", trigger }
  // 막혔을 때 같은 후보로 이미 코드 순서를 만들어 두었으면 그것을 다시 쓴다 — 열 때마다 줄이 쌓이지 않게
  if (lastAny && lastAny.day === today && lastAny.candidateHash === hash) return { kind: "reuse", run: lastAny }
  return { kind: "code", trigger, reason }
}

// ── AI 요청 · 응답 ─────────────────────────────────────

const KIND_WORD: Record<CandidateKind, string> = {
  approval: "응답을 기다리는 알림(업무 수락 · 완료 확인)",
  task_due: "마감이 오늘 · 내일인 내 업무",
  mention: "나를 @ 로 부른 글(아직 답하지 않음)",
  name_call: "본문에 내 이름 · 호칭이 들어간 다른 사람의 글, 또는 업무 스레드에서 내 글 뒤에 이어 쓴 글(아직 답하지 않음) — 요청인지 잡담인지는 글을 보고 판단",
  participating_task: "담당은 아니지만 최근 2주 안에 내가 글을 남긴 업무 — 마감이 오늘 · 내일",
  grant_due: "내가 맡은 국가과제 준비 — 마감이 다가옴",
  applications: "새 채용 지원서",
}

export const SUGGESTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { id: { type: "STRING" }, line: { type: "STRING" } }, required: ["id", "line"] },
    },
  },
  required: ["items"],
}

export function buildPrompt(cs: Candidate[], now: Date): { prompt: string; ids: Map<string, string> } {
  const ids = new Map<string, string>()
  const list = cs.map((c, i) => {
    const id = `c${i + 1}`
    ids.set(id, c.key)
    return { id, kind: KIND_WORD[c.kind], title: c.title, detail: c.detail.slice(0, 160), due: dueWord(c.due, now) || null }
  })
  const prompt = `너는 사내 업무 도구 「옴니스」 다. 아래는 이 사람이 지금 해야 할 수도 있는 일의 후보다(오늘은 ${seoulDay(now)}, 서울).
가장 먼저 할 일부터 순서를 정하고, 후보마다 첫 화면 카드에 들어갈 한국어 한 줄을 써라.

순서: 마감이 지났거나 오늘인 것, 다른 사람이 기다리는 것(수락 · 확인 · 나를 부른 글)을 앞에 둔다.
빼기: kind 가 「본문에 내 이름 · 호칭이 들어간 … / 내 글 뒤에 이어 쓴 글」 인 후보는 그 글이 이 사람에게 일을 부탁하거나 묻거나 확인을 바라는 것일 때만 남긴다. 잡담 · 인사 · 이름을 지나가듯 말한 것 · 이미 끝난 이야기면 결과에서 아예 빼라. 다른 종류는 빼지 않는다.
한 줄: 40자 안. 무엇을 하면 되는지 대상 이름을 넣어 쓴다. 「~해야 합니다」 「~가 기다리고 있습니다」 처럼 담백하게. 명령형 · 느낌표 · 이모지 · 따옴표 장식은 쓰지 않는다. 후보에 없는 사실을 지어내지 않는다.

JSON {"items":[{"id":"c1","line":"…"}]} 으로, 남길 후보를 순서대로 한 번씩 돌려준다.

후보:
${JSON.stringify(list)}`
  return { prompt, ids }
}

/**
 * 응답 → (순서, 한 줄). 모르는 id 는 버리고, 빠진 후보는 코드 순서로 뒤에 붙인다.
 * 단 본문 이름 부름(name_call)은 AI 가 「요청이 아니다」 로 뺀 것이라 다시 붙이지 않는다(추가 AI 호출 없이 오탐을 거른다).
 */
export function parseAiOrder(text: string, ids: Map<string, string>, cs: Candidate[]): { ordered: Candidate[]; lines: Map<string, string> } {
  const raw = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as { items?: { id?: unknown; line?: unknown }[] }
  const byKey = new Map(cs.map((c) => [c.key, c]))
  const ordered: Candidate[] = []
  const lines = new Map<string, string>()
  for (const it of Array.isArray(raw.items) ? raw.items : []) {
    const key = typeof it.id === "string" ? ids.get(it.id) : undefined
    const c = key ? byKey.get(key) : undefined
    if (!c || ordered.includes(c)) continue
    ordered.push(c)
    const line = typeof it.line === "string" ? it.line.replace(/\s+/g, " ").trim() : ""
    if (line && line.length <= 60) lines.set(c.key, line)
  }
  if (ordered.length === 0 && cs.some((c) => c.kind !== "name_call")) throw new Error("제안 응답에 쓸 수 있는 후보가 없다")
  for (const c of codeOrder(cs)) if (!ordered.includes(c) && c.kind !== "name_call") ordered.push(c)
  return { ordered, lines }
}

// ── 본문 이름 부름 ───────────────────────────────────

/** 업무 스레드에서 내 글 뒤에 이어 쓴 글의 표시(후보 detail 앞) — AI 에도 그대로 간다 */
export const FOLLOW_UP = "(내 글에 이어 쓴 글)"

const HANGUL_NAME = /^[가-힣]{2,4}$/
const CALL_SUFFIX = ["님", "씨", "아", "야", "쌤", "선생님", "주임님", "연구원님"]

/**
 * 글 본문에서 이 사람을 부르는 꼴. 계정 이름에서 만든다 — 「정우창」 → 정우창 · 우창님 · 우창씨 · 우창아 …
 * 성을 뺀 이름만으로는 흔한 낱말과 겹칠 수 있어 호칭을 붙인 꼴만 쓴다. 두 글자 이름(성 + 한 글자)은 전체 이름만 쓴다.
 * aliases 는 카톡 표시명 같은 다른 이름(설정 home.nameAliases) — 그대로 더한다.
 */
export function callForms(name: string, aliases: string[] = []): string[] {
  const n = name.replace(/\s+/g, "")
  const out = new Set<string>()
  if (n.length >= 2) out.add(n)
  if (HANGUL_NAME.test(n) && n.length >= 3) {
    const given = n.slice(1)
    for (const s of CALL_SUFFIX) out.add(given + s)
  }
  for (const a of aliases) if (a.trim().length >= 2) out.add(a.trim())
  return [...out]
}

/** 이 글이 이 사람을 부르나 — 꼴 하나라도 들어 있으면. @멘션은 mention 후보가 따로 본다 */
export const callsName = (text: string, forms: string[]) => forms.some((f) => text.includes(f))

// ── 쉬어 가는 카드(후보 0건) ─────────────────────────

const REST_POOL: { key: string; line: string; prompt: string }[] = [
  {
    key: "rest:vacation",
    line: "오늘 급한 일은 다 끝났어요. 휴가 계획을 잡아 볼까요?",
    // 옴니스에는 근태(연차 · 휴가) 기록이 없다(2026-11-27 확인) — 캘린더 · 업무 마감을 보고 같이 짜 달라고 묻는다
    prompt: "휴가 계획을 같이 짜 줘. 다음 한 달 내 업무 마감과 회사 캘린더 일정을 보고 쉬기 좋은 날을 골라 줘.",
  },
  {
    key: "rest:wordchain",
    line: "옴니스랑 끝말잇기 한 판 하실래요?",
    prompt: "끝말잇기 한 판 하자. 네가 먼저 낱말 하나로 시작해 줘. 규칙은 보통 끝말잇기대로, 두음법칙은 허용.",
  },
  {
    key: "rest:week",
    line: "숨 돌리는 김에 이번 주에 한 일을 돌아볼까요?",
    prompt: "이번 주에 내가 한 일과 끝낸 업무를 짧게 돌아봐 줘.",
  },
]

/** 날마다 바뀌는 쉬어 가는 카드 두 장(서울 날짜 기준). AI 를 부르지 않는다 */
export function restItems(now: Date): SuggestionItem[] {
  const day = Math.floor(Date.parse(`${seoulDay(now)}T00:00:00Z`) / 86_400_000)
  const a = REST_POOL[day % REST_POOL.length]
  const b = REST_POOL[(day + 1) % REST_POOL.length]
  return [a, b].map((r) => ({ key: r.key, kind: "rest" as const, title: "", line: r.line, due: null, action: { type: "ask" as const, prompt: r.prompt } }))
}

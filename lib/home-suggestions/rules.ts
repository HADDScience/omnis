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

export type CandidateKind = "approval" | "task_due" | "mention" | "grant_due" | "applications"
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
  kind: CandidateKind
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

const KIND_RANK: Record<CandidateKind, number> = { approval: 0, task_due: 1, grant_due: 2, mention: 3, applications: 4 }

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
    case "grant_due":
      return `「${c.title}」 ${due} — 준비 상황 정리`
    case "mention":
      return `${c.title}님이 부른 글에 답하기`
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
  mention: "나를 부른 글(아직 답하지 않음)",
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
한 줄: 40자 안. 무엇을 하면 되는지 대상 이름을 넣어 쓴다. 「~해야 합니다」 「~가 기다리고 있습니다」 처럼 담백하게. 명령형 · 느낌표 · 이모지 · 따옴표 장식은 쓰지 않는다. 후보에 없는 사실을 지어내지 않는다.

JSON {"items":[{"id":"c1","line":"…"}]} 으로, 후보 전부를 순서대로 한 번씩 돌려준다.

후보:
${JSON.stringify(list)}`
  return { prompt, ids }
}

/** 응답 → (순서, 한 줄). 모르는 id 는 버리고, 빠진 후보는 코드 순서로 뒤에 붙인다 */
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
  if (ordered.length === 0) throw new Error("제안 응답에 쓸 수 있는 후보가 없다")
  for (const c of codeOrder(cs)) if (!ordered.includes(c)) ordered.push(c)
  return { ordered, lines }
}

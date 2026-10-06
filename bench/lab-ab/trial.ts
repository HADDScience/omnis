// 블라인드 A/B 평가 — 서버 쪽 로직. 화면은 app/lab/ab, API 는 app/api/lab/ab/route.ts.
// 계획: mydocs/plans/2026-10-06-weknora-lab.md 「블라인드 A/B 화면」
//
// 블라인드를 지키는 곳은 여기 한 곳이다.
//   - 두 팔을 동시에 돌리고 A/B 자리는 서버가 무작위로 정한다. 어느 팔이 어느 자리인지는 sessions.jsonl 에만 남는다.
//   - 화면으로 나가는 것은 trialId · 진행 단계(중립 이름) · 두 쪽이 다 끝난 뒤의 답 · 시간 · 비용뿐이다.
//   - 오류 문구는 팔을 드러낼 수 있어("20회 한도 …") 화면에는 일반 문구로 바꿔 보낸다. 원문은 sessions.jsonl 에 있다.
// 집계(블라인드 해제)는 bench/report-ab.ts.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs"
import { randomInt, randomUUID } from "crypto"
import { homedir } from "os"
import { join } from "path"
import { z } from "zod"
import type { Caller } from "@/lib/omnis-mcp"
import { MODELS, METHODS, usdToKrw, type MethodName } from "../config"
import { runMethod, type MethodResult } from "../methods"
import { costUsd } from "../providers"
import { appendLedger, readLedger } from "../ledger"
import { loadQuestions } from "../questions"

/** 스모크(bench/lab-ab/smoke.ts)는 LAB_AB_DIR 로 다른 폴더에 써서 본 평가 기록을 더럽히지 않는다 */
export const LAB_DIR = process.env.LAB_AB_DIR ?? "bench/results/lab-ab"
export const SESSIONS_FILE = join(LAB_DIR, "sessions.jsonl")
export const VOTES_FILE = join(LAB_DIR, "votes.jsonl")
/** 비용 장부(bench/results/ledger.jsonl)의 run 이름 */
export const LEDGER_RUN = "lab-ab"
/** 모든 팔이 같은 생성 모델을 쓴다 (계획서 「비교할 팔」) */
export const MODEL_KEY = "gemini-3.8-flash@low"
/** 쌍마다 목표 평가 수 */
export const GOAL_PER_PAIR = 30

/** 팔 이름 → bench 방법. 바꾸려면 여기만 고친다. METHODS 에 없는 방법은 「준비 안 됨」 */
export const ARMS = {
  N0: "native",
  A1: "wk-agent",
  R: "wk-r3",
  WK: "weknora-real",
} as const
export type Arm = keyof typeof ARMS

export const PAIRS = {
  "N0-A1": ["N0", "A1"],
  "N0-R": ["N0", "R"],
  "A1-WK": ["A1", "WK"],
} as const satisfies Record<string, readonly [Arm, Arm]>
export type Pair = keyof typeof PAIRS
export const PAIR_KEYS = Object.keys(PAIRS) as Pair[]

export type Side = "A" | "B"

export function armReady(arm: Arm): boolean {
  return (METHODS as readonly string[]).includes(ARMS[arm])
}

export function pairReady(pair: Pair): boolean {
  return PAIRS[pair].every(armReady)
}

export function budgetKrw(): number {
  return Number(process.env.BENCH_BUDGET_KRW ?? 5000)
}

/** 장부의 lab-ab 줄 합계 (원) */
export function spentKrw(): number {
  return Math.round(readLedger().filter((r) => r.runId === LEDGER_RUN).reduce((a, r) => a + r.krw + (r.judgeKrw ?? 0), 0) * 100) / 100
}

// ── 기록 형식 ─────────────────────────────────────────────

export interface SessionSide {
  arm: Arm
  method: string
  answer: string
  sec: number
  krw: number
  calls: number
  trace?: MethodResult["trace"]
  error?: string
}

export interface SessionRow {
  trialId: string
  at: string
  pair: Pair
  qid: string | null
  question: string
  model: string
  sides: Record<Side, SessionSide>
}

export const scoreSchema = z.object({
  /** 답 만족 */
  satisfy: z.number().int().min(1).max(5),
  /** 근거 신뢰 */
  trust: z.number().int().min(1).max(5),
  /** 기다릴 만했나 */
  worthWait: z.number().int().min(1).max(5),
  /** 알아서 해냈다 */
  agentic: z.number().int().min(1).max(5),
})
export type Scores = z.infer<typeof scoreSchema>

export const voteSchema = z.object({
  trialId: z.string().min(1).max(64),
  prefer: z.enum(["A", "B", "tie"]),
  scores: z.object({ A: scoreSchema, B: scoreSchema }),
  /** 평가자가 팔을 짐작했다면 메모 (예: "A=에이전트 같음") */
  guessed: z.string().trim().max(200).optional(),
  note: z.string().trim().max(2000).optional(),
})
export type VoteInput = z.infer<typeof voteSchema>

export interface VoteRow extends VoteInput {
  at: string
  voter: string
}

export const runSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  qid: z.string().max(64).optional(),
  pair: z.enum(PAIR_KEYS as [Pair, ...Pair[]]),
})
export type RunInput = z.infer<typeof runSchema>

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T)
}

function appendJsonl(file: string, row: unknown) {
  mkdirSync(LAB_DIR, { recursive: true })
  appendFileSync(file, JSON.stringify(row) + "\n")
}

export const readSessions = () => readJsonl<SessionRow>(SESSIONS_FILE)
export const readVotes = () => readJsonl<VoteRow>(VOTES_FILE)

// ── 진행 단계의 중립 이름 ──────────────────────────────────
// 도구 이름이 팔을 드러낸다 (grep_chunks · read_document · todo_write 는 wk-agent 에만 있다).
// 화면에는 하는 일만 보여준다. todo_write 는 「계획 메모」 로 바꿔도 A1 에만 나온다 — 남은 단서다.
const LABELS: [RegExp, string][] = [
  [/^(search_knowledge|grep_chunks|wk-)/, "검색"],
  [/^(read_document|read_file|get_)/, "원문 읽기"],
  [/^(list_|crm_overview|ip_overview|find_org|company_profile)/, "목록 조회"],
  [/^todo_write$/, "계획 메모"],
]

export function neutralLabel(tool: string): string {
  return LABELS.find(([re]) => re.test(tool))?.[1] ?? "도구"
}

/** 인자 중 첫 문자열 값만 40자까지 — 인자 이름(query · pattern …)도 팔마다 달라 값만 보인다 */
export function neutralDetail(args: Record<string, unknown>): string | undefined {
  const v = Object.values(args).find((x): x is string => typeof x === "string" && x.trim().length > 0)
  if (!v) return undefined
  const t = v.replace(/\s+/g, " ").trim()
  return t.length > 40 ? `${t.slice(0, 40)}…` : t
}

// ── 실행 ─────────────────────────────────────────────────

export interface SideView {
  answer: string
  sec: number
  krw: number
  /** 화면용 일반 문구. 원문은 sessions.jsonl */
  failed?: string
}

export type TrialEvent =
  | { type: "start"; trialId: string }
  | { type: "step"; side: Side; label: string; detail?: string }
  | { type: "finished"; side: Side }
  | { type: "result"; trialId: string; sides: Record<Side, SideView>; spentKrw: number }
  | { type: "error"; message: string }

export class LabError extends Error {}

/** 실행 전 검사. 통과하지 못하면 LabError — 비용이 나가기 전에 거른다 */
export function checkRun(input: RunInput) {
  const notReady = PAIRS[input.pair].filter((a) => !armReady(a))
  if (notReady.length) throw new LabError(`준비 안 됨: ${notReady.map((a) => `${a}(${ARMS[a]})`).join(", ")} 팔이 등록돼 있지 않습니다`)
  const spent = spentKrw()
  const cap = budgetKrw()
  if (spent >= cap) throw new LabError(`예산 상한: 누적 ${spent.toFixed(0)}원 ≥ BENCH_BUDGET_KRW ${cap}원 — 실행하지 않았습니다`)
}

/**
 * 두 팔을 동시에 돌린다. 진행은 emit 으로 흘려보내고, 두 쪽이 다 끝나면 기록한 뒤 result 를 보낸다.
 * caller 는 도구가 권한을 판단할 사람 (bench run.ts 와 같은 Caller).
 */
export async function runTrial(input: RunInput, caller: Caller, emit: (e: TrialEvent) => void): Promise<SessionRow> {
  checkRun(input)
  const model = MODELS.find((m) => m.key === MODEL_KEY)
  if (!model) throw new LabError(`모델 ${MODEL_KEY} 가 config 에 없습니다`)

  const trialId = randomUUID()
  const [first, second] = PAIRS[input.pair]
  const flip = randomInt(2) === 1
  const armOf: Record<Side, Arm> = { A: flip ? second : first, B: flip ? first : second }
  emit({ type: "start", trialId })

  const runSide = async (side: Side): Promise<SessionSide> => {
    const arm = armOf[side]
    const method = ARMS[arm] as MethodName
    const t0 = Date.now()
    let r: MethodResult | null = null
    let error: string | undefined
    try {
      r = await runMethod(method, model, input.question, caller, (tool, args) => {
        emit({ type: "step", side, label: neutralLabel(tool), detail: neutralDetail(args) })
      })
      error = r.error
    } catch (err) {
      error = String(err).slice(0, 500)
    }
    const sec = Math.round((Date.now() - t0) / 100) / 10
    const krw = r ? usdToKrw(costUsd(r.usage, model.price) + (r.extraCostUsd ?? 0)) : 0
    emit({ type: "finished", side })
    return { arm, method, answer: r?.answer ?? "", sec, krw, calls: r?.calls ?? 0, trace: r?.trace, error }
  }

  const [a, b] = await Promise.all([runSide("A"), runSide("B")])
  const row: SessionRow = {
    trialId, at: new Date().toISOString(), pair: input.pair, qid: input.qid ?? null, question: input.question, model: model.key,
    sides: { A: a, B: b },
  }
  appendJsonl(SESSIONS_FILE, row)
  appendLedger({ kind: "run", runId: LEDGER_RUN, krw: Math.round((a.krw + b.krw) * 100) / 100, note: `${trialId}|${input.pair}|${input.qid ?? "직접 입력"}` })

  const view = (s: SessionSide): SideView => ({
    answer: s.answer, sec: s.sec, krw: s.krw,
    failed: s.error ? "이 쪽은 답을 끝내지 못했습니다. 보이는 답(있으면)으로 평가하거나 다음 문항으로 넘어가세요." : undefined,
  })
  emit({ type: "result", trialId, sides: { A: view(a), B: view(b) }, spentKrw: spentKrw() })
  return row
}

// ── 평가 ─────────────────────────────────────────────────

export function recordVote(input: VoteInput, voter: string): VoteRow {
  if (!readSessions().some((s) => s.trialId === input.trialId)) throw new LabError("모르는 trialId 입니다 — 실행 기록이 없습니다")
  if (readVotes().some((v) => v.trialId === input.trialId)) throw new LabError("이미 평가한 시행입니다")
  const row: VoteRow = { at: new Date().toISOString(), voter, ...input, guessed: input.guessed || undefined, note: input.note || undefined }
  appendJsonl(VOTES_FILE, row)
  return row
}

// ── 진행 현황 · 문항 뽑기 ──────────────────────────────────

export interface LabStatus {
  goal: number
  spentKrw: number
  budgetKrw: number
  totalVotes: number
  pairs: { pair: Pair; ready: boolean; votes: number }[]
}

export function labStatus(): LabStatus {
  const sessions = new Map(readSessions().map((s) => [s.trialId, s]))
  const votes = readVotes()
  const per = (p: Pair) => votes.filter((v) => sessions.get(v.trialId)?.pair === p).length
  return {
    goal: GOAL_PER_PAIR, spentKrw: spentKrw(), budgetKrw: budgetKrw(), totalVotes: votes.length,
    pairs: PAIR_KEYS.map((pair) => ({ pair, ready: pairReady(pair), votes: per(pair) })),
  }
}

/** AB_QUESTIONS → 확정 세트 → 초안(.draft.json) 순서로 첫 번째 있는 파일 */
export function questionFile(): string | null {
  const base = `${process.env.KAKAO_DATA_DIR ?? join(homedir(), "work/omnis-import")}/eval/agentic-261006`
  const candidates = [process.env.AB_QUESTIONS, `${base}.json`, `${base}.draft.json`].filter((f): f is string => !!f)
  return candidates.find((f) => existsSync(f)) ?? null
}

/** 이 쌍에서 아직 평가하지 않은 문항 하나를 무작위로 */
export function pickQuestion(pair: Pair): { qid: string; q: string; left: number; file: string } | null {
  const file = questionFile()
  if (!file) return null
  const sessions = new Map(readSessions().map((s) => [s.trialId, s]))
  const done = new Set(readVotes().map((v) => sessions.get(v.trialId)).filter((s) => s?.pair === pair && s.qid).map((s) => s!.qid!))
  const left = loadQuestions(file).filter((q) => !done.has(q.id))
  if (left.length === 0) return null
  const q = left[randomInt(left.length)]
  return { qid: q.id, q: q.q, left: left.length, file: file.split("/").pop()! }
}

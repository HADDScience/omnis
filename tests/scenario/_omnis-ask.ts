import { type Page, type TestInfo, expect } from "@playwright/test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { closePanel, type Actor } from "./_actors"

/**
 * 옴니스 AI 질의 — 여러 사람이 동시에 /omnis/ask 화면에서 회사에 대해 묻는다.
 *
 * 사람마다 자기 질문을 차례로 묻고, 사람들끼리는 동시에 움직인다. 화면이 부르는
 * `/api/omnis/ask` 응답을 그대로 잡아 답변·출처·meta(모델 호출 수·토큰·단계별 ms)를 얻고,
 * 화면에서는 「질문하기」를 누른 순간부터 답변 카드가 보일 때까지를 잰다.
 *
 * 정확도는 두 가지다. ① 기대 문자열이 답변에 있는지(결정적). ② 심판 모델 0·1·2 점(bench/judge).
 * 질문 파일은 사내 업무가 적혀 있어 저장소 밖에 둔다 — bench 와 같은 규칙.
 */

export interface AskQuestion {
  q: string
  expect: string[]
  /** 이 질문을 누가 묻나. 없으면 사람들에게 돌아가며 나눈다 */
  actor?: string
  /**
   * 실행 시점 자료로 기대값을 만든다.
   *   overdue  지연된 업무 건수·이름 (화면의 /api/tasks 로 센다)
   *   mine     질문자가 담당인 진행 중 업무 이름
   */
  dynamic?: "overdue" | "mine"
}

export interface AskRow {
  actor: string
  q: string
  expect: string[]
  answer: string
  hits: string[]
  judge: { score: number; hallucination: boolean; reason: string } | null
  /** 화면: 버튼 클릭 → 답변 카드 표시 */
  uiMs: number
  /** 서버 meta (route 일 때 채워진다) */
  meta: {
    mode: string
    model: string
    calls: number
    usage: { promptTokens: number; candidateTokens: number; thinkingTokens: number; cachedTokens: number }
    ms: { total: number; llm: number; tools: number }
    trace: { step: number; tool: string; args: Record<string, unknown>; resultChars: number; ms: number }[]
  } | null
  sources: number
  error?: string
}

export interface AskSummary {
  rows: AskRow[]
  n: number
  errors: number
  hitRate: number
  judgeAvg: number | null
  judgeFull: number
  hallucinations: number
  uiP50: number
  uiP90: number
  serverP50: number
  tokens: { prompt: number; candidate: number; thinking: number; cached: number }
  /** 질문 1건 평균 원 (환율 BENCH_KRW_PER_USD, 기본 1,380) */
  krwPerQuestion: number
  /** 여러 사람이 동시에 물은 구간 전체 wall-clock */
  wallMs: number
}

const DEFAULT_QUESTIONS = `${process.env.KAKAO_DATA_DIR ?? `${process.env.HOME}/work/omnis-import`}/eval/omnis-ask-260910.json`

export function loadAskQuestions(file = process.env.E2E_OMNIS_QUESTIONS ?? DEFAULT_QUESTIONS): AskQuestion[] {
  if (!existsSync(file)) {
    throw new Error(`옴니스 질의 파일이 없습니다: ${file}\n{"ask": [{"q": "...", "expect": ["..."], "actor": "이름"}]} 형식으로 만들거나 E2E_OMNIS_QUESTIONS 로 주세요.`)
  }
  return (JSON.parse(readFileSync(file, "utf-8")) as { ask: AskQuestion[] }).ask
}

// ─── 화면 조작 ───────────────────────────────────────────────

function askBox(page: Page) {
  return page.getByRole("textbox", { name: "옴니스에게 보낼 질문" })
}

/** 질문 하나를 화면에서 묻고 응답·시간을 돌려준다 */
export async function askOnScreen(page: Page, question: string, timeout = 120_000): Promise<{ uiMs: number; body: Record<string, unknown> | null; status: number }> {
  await askBox(page).fill(question)
  const responseP = page.waitForResponse((r) => r.url().includes("/api/omnis/ask") && r.request().method() === "POST", { timeout })
  const t0 = Date.now()
  // Enter 로 보낸다. 우측 패널(채팅)이 열려 있으면 「질문하기」 버튼을 덮어 클릭이 막힌다 — 킥오프 뒤 대표 화면에서 실제로 났다.
  await askBox(page).press("Enter")
  const res = await responseP
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (res.ok()) {
    // 답변 카드는 질문 제목(h2)으로 나타난다. 첫 카드가 방금 질문이어야 한다.
    await expect(page.getByRole("heading", { name: question.slice(0, 40) }).first()).toBeVisible({ timeout: 15_000 })
  }
  return { uiMs: Date.now() - t0, body, status: res.status() }
}

// ─── 동적 기대값 ─────────────────────────────────────────────

interface ApiTask { id: string; name: string; status: string; deadline: string | null; assignees?: { user: { name: string } }[] }

async function fetchTasks(page: Page): Promise<ApiTask[]> {
  return page.evaluate(async () => {
    const res = await fetch("/api/tasks")
    return (await res.json()) as ApiTask[]
  })
}

async function resolveDynamic(page: Page, actor: string, q: AskQuestion): Promise<string[]> {
  if (!q.dynamic) return q.expect
  const tasks = await fetchTasks(page)
  if (q.dynamic === "overdue") {
    const now = Date.now()
    const overdue = tasks.filter((t) => t.status !== "DONE" && t.deadline && new Date(t.deadline).getTime() < now)
    return [...q.expect, String(overdue.length), ...overdue.slice(0, 2).map((t) => t.name.slice(0, 12))]
  }
  if (q.dynamic === "mine") {
    const mine = tasks.filter((t) => t.status === "IN_PROGRESS" && t.assignees?.some((a) => a.user.name === actor))
    return [...q.expect, ...mine.slice(0, 3).map((t) => t.name.slice(0, 12))]
  }
  return q.expect
}

// ─── 실행 ───────────────────────────────────────────────────

export interface RunAskOptions {
  judge?: boolean
  /** 보고서 파일 이름 앞부분 (없으면 저장하지 않는다) */
  reportTag?: string
}

export async function runOmnisAsk(actors: Actor[], questions: AskQuestion[], info: TestInfo, opts: RunAskOptions = {}): Promise<AskSummary> {
  const byActor = new Map<string, AskQuestion[]>()
  actors.forEach((a) => byActor.set(a.name, []))
  questions.forEach((q, i) => {
    const owner = q.actor && byActor.has(q.actor) ? q.actor : actors[i % actors.length].name
    byActor.get(owner)!.push(q)
  })

  const judgeFn = opts.judge === false ? null : (await import("../../bench/judge")).judge
  const rows: AskRow[] = []
  const wall0 = Date.now()

  await Promise.all(
    actors.map(async (actor) => {
      const mine = byActor.get(actor.name) ?? []
      if (mine.length === 0) return
      await actor.page.goto("/omnis/ask")
      await closePanel(actor.page)
      await expect(askBox(actor.page)).toBeVisible({ timeout: 15_000 })
      for (const q of mine) {
        const expectList = await resolveDynamic(actor.page, actor.name, q)
        let row: AskRow
        try {
          const { uiMs, body, status } = await askOnScreen(actor.page, q.q)
          const answer = String(body?.answer ?? "")
          const meta = (body?.meta as AskRow["meta"]) ?? null
          const sources = Array.isArray(body?.sources) ? (body!.sources as unknown[]).length : 0
          row = {
            actor: actor.name, q: q.q, expect: expectList, answer, hits: expectList.filter((e) => answer.includes(e)),
            judge: null, uiMs, meta, sources, error: status >= 400 ? `HTTP ${status}: ${String(body?.error ?? "")}` : undefined,
          }
          if (judgeFn && answer && !row.error) {
            // 서버 meta 에는 도구 결과 본문이 없다(응답이 커진다). 심판에게는 "생략" 으로 알려 기대 사실과의
            // 모순만 환각으로 세게 한다 — 첫 실행에서 맞는 답(견적 5건)을 지어냈다고 판정한 일이 있어서다.
            const evidence = `(생략) 부른 도구: ${meta?.trace.map((t) => `${t.tool}${JSON.stringify(t.args)}`).join(" → ") ?? "없음"}`
            const j = await judgeFn(q.q, expectList, answer, evidence)
            row.judge = { score: j.score, hallucination: j.hallucination, reason: j.reason }
          }
        } catch (err) {
          row = { actor: actor.name, q: q.q, expect: expectList, answer: "", hits: [], judge: null, uiMs: 0, meta: null, sources: 0, error: String(err).slice(0, 300) }
        }
        rows.push(row)
        const j = row.judge ? ` 심판 ${row.judge.score}${row.judge.hallucination ? "!" : ""}` : ""
        console.log(`[옴니스 질의] ${actor.name} · ${q.q.slice(0, 30)}… 근거 ${row.hits.length}/${row.expect.length}${j} · 화면 ${(row.uiMs / 1000).toFixed(1)}s · 호출 ${row.meta?.calls ?? "?"}${row.error ? ` ✗ ${row.error}` : ""}`)
      }
    }),
  )

  const summary = summarize(rows, Date.now() - wall0)
  info.annotations.push({ type: "옴니스 질의", description: `${summary.n}문항 · 근거 ${Math.round(summary.hitRate * 100)}% · 심판 ${summary.judgeAvg ?? "-"} · 화면 p50 ${(summary.uiP50 / 1000).toFixed(1)}s · ${summary.krwPerQuestion}원/문항` })
  if (opts.reportTag) writeAskReport(opts.reportTag, summary)
  return summary
}

function pct(xs: number[], p: number) {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]
}

/** 요금: Gemini 3.8 Flash 2026-09 기준 $0.75 / $3.75. 모델이 다르면 BENCH_PRICE_IN·OUT 로 바꾼다 */
function krw(t: AskSummary["tokens"], n: number): number {
  const pin = Number(process.env.BENCH_PRICE_IN ?? 0.75)
  const pout = Number(process.env.BENCH_PRICE_OUT ?? 3.75)
  const fx = Number(process.env.BENCH_KRW_PER_USD ?? 1380)
  const usd = (t.prompt * pin + (t.candidate + t.thinking) * pout) / 1_000_000
  return n ? Math.round((usd * fx) / n * 100) / 100 : 0
}

export function summarize(rows: AskRow[], wallMs: number): AskSummary {
  const ok = rows.filter((r) => !r.error)
  const judged = ok.filter((r) => r.judge)
  const tokens = ok.reduce(
    (a, r) => ({
      prompt: a.prompt + (r.meta?.usage.promptTokens ?? 0),
      candidate: a.candidate + (r.meta?.usage.candidateTokens ?? 0),
      thinking: a.thinking + (r.meta?.usage.thinkingTokens ?? 0),
      cached: a.cached + (r.meta?.usage.cachedTokens ?? 0),
    }),
    { prompt: 0, candidate: 0, thinking: 0, cached: 0 },
  )
  return {
    rows,
    n: rows.length,
    errors: rows.length - ok.length,
    hitRate: ok.length ? ok.reduce((a, r) => a + r.hits.length, 0) / Math.max(ok.reduce((a, r) => a + r.expect.length, 0), 1) : 0,
    judgeAvg: judged.length ? Math.round((judged.reduce((a, r) => a + r.judge!.score, 0) / judged.length) * 100) / 100 : null,
    judgeFull: judged.filter((r) => r.judge!.score === 2).length,
    hallucinations: judged.filter((r) => r.judge!.hallucination).length,
    uiP50: pct(ok.map((r) => r.uiMs), 0.5),
    uiP90: pct(ok.map((r) => r.uiMs), 0.9),
    serverP50: pct(ok.map((r) => r.meta?.ms.total ?? 0), 0.5),
    tokens,
    krwPerQuestion: krw(tokens, ok.length),
    wallMs,
  }
}

export function writeAskReport(tag: string, s: AskSummary) {
  const dir = path.join(process.cwd(), "tests/scenario/reports")
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `${tag}-omnis-ask.json`), JSON.stringify(s, null, 2))
  const md = [
    `# 옴니스 질의 ${tag}`,
    "",
    `| 문항 | 오류 | 근거 적중 | 심판 평균 | 만점 | 환각 | 화면 p50 | 화면 p90 | 서버 p50 | 동시 구간 | 원/문항 |`,
    `|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|`,
    `| ${s.n} | ${s.errors} | ${Math.round(s.hitRate * 100)}% | ${s.judgeAvg ?? "-"} | ${s.judgeFull} | ${s.hallucinations} | ${(s.uiP50 / 1000).toFixed(1)}s | ${(s.uiP90 / 1000).toFixed(1)}s | ${(s.serverP50 / 1000).toFixed(1)}s | ${(s.wallMs / 1000).toFixed(0)}s | ${s.krwPerQuestion} |`,
    "",
    `토큰 합계: 입력 ${s.tokens.prompt.toLocaleString()} · 출력 ${s.tokens.candidate.toLocaleString()} · thinking ${s.tokens.thinking.toLocaleString()} · 캐시 ${s.tokens.cached.toLocaleString()}`,
    "",
    "| 누가 | 질문 | 근거 | 심판 | 화면 | 서버 | 호출 | 도구 | 원 |",
    "|---|---|--:|--:|--:|--:|--:|---|--:|",
    ...s.rows.map((r) => {
      const t = r.meta?.usage
      const won = t ? krw({ prompt: t.promptTokens, candidate: t.candidateTokens, thinking: t.thinkingTokens, cached: t.cachedTokens }, 1) : 0
      return `| ${r.actor} | ${r.q} | ${r.hits.length}/${r.expect.length} | ${r.judge ? `${r.judge.score}${r.judge.hallucination ? "!" : ""}` : "-"} | ${(r.uiMs / 1000).toFixed(1)}s | ${r.meta ? (r.meta.ms.total / 1000).toFixed(1) + "s" : "-"} | ${r.meta?.calls ?? "-"} | ${r.meta?.trace.map((x) => x.tool).join(" → ") ?? "-"} | ${won} |${r.error ? ` ✗ ${r.error}` : ""}`
    }),
    "",
    "## 답변",
    "",
    ...s.rows.map((r) => `### ${r.actor} · ${r.q}\n\n${r.judge ? `심판 ${r.judge.score} — ${r.judge.reason}\n\n` : ""}${(r.answer || "(빈 답변)").split("\n").map((l) => `> ${l}`).join("\n")}\n`),
  ].join("\n")
  writeFileSync(path.join(dir, `${tag}-omnis-ask.md`), md)
}

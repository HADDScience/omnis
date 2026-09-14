// 그리드 실행 — 모델 × 방법론 × 질문을 한 줄씩 results.jsonl 에 쌓는다.
//
//   npx tsx bench/run.ts [--models a,b] [--methods baseline,route] [--questions <파일>]
//                        [--limit N] [--run <이전 run 폴더명>] [--no-judge] [--user 정우창] [--list]
//
// 중단하고 같은 --run 으로 다시 돌리면 이미 있는 (모델·방법·질문) 은 건너뛴다.
// 끝나면 report.ts 를 불러 summary.md · summary.csv 를 만든다.
// 계획: mydocs/plans/2026-09-09-model-method-benchmark.md
import "dotenv/config"
import { mkdirSync, existsSync, readFileSync, appendFileSync, writeFileSync } from "fs"
import { join } from "path"
import { prisma } from "@/lib/db"
import type { Caller } from "@/lib/omnis-mcp"
import { MODELS, METHODS, JUDGE_MODEL, KRW_PER_USD, usdToKrw, modelAvailable, type MethodName, type ModelSpec } from "./config"
import { runMethod, type MethodResult } from "./methods"
import { judge, expectHits, type JudgeResult } from "./judge"
import { costUsd } from "./providers"
import { writeReport } from "./report"

export interface Question { id: string; q: string; expect: string[] }

export interface ResultRow {
  runId: string
  model: string
  modelId: string
  method: MethodName
  qid: string
  question: string
  expect: string[]
  answer: string
  hits: string[]
  hitTotal: number
  judge: Omit<JudgeResult, "usage" | "ms"> | null
  usage: MethodResult["usage"]
  costUsd: number
  costKrw: number
  timings: MethodResult["timings"]
  calls: number
  promptChars: number
  refs: MethodResult["refs"]
  trace?: MethodResult["trace"]
  finish?: string
  note?: string
  error?: string
  at: string
}

const args = process.argv.slice(2)
const opt = (k: string): string | undefined => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
const flag = (k: string) => args.includes(k)

function loadQuestions(file: string): Question[] {
  const raw = JSON.parse(readFileSync(file, "utf8")) as { ask: { q: string; expect: string[] }[] }
  return raw.ask.map((a, i) => ({ id: `A${i + 1}`, q: a.q, expect: a.expect }))
}

function pick<T extends { key?: string } | string>(all: readonly T[], csv: string | undefined, name: (t: T) => string): T[] {
  if (!csv) return [...all]
  const want = csv.split(",").map((s) => s.trim()).filter(Boolean)
  const out = want.map((w) => all.find((t) => name(t) === w))
  const missing = want.filter((_, i) => !out[i])
  if (missing.length) throw new Error(`모르는 항목: ${missing.join(", ")}. 가능한 값: ${all.map(name).join(", ")}`)
  return out as T[]
}

async function resolveCaller(name: string): Promise<Caller> {
  const user = await prisma.user.findFirst({ where: { name: { contains: name }, isActive: true }, select: { id: true, name: true, role: true } })
  if (!user) throw new Error(`사용자 "${name}" 를 찾지 못했습니다 (--user 로 지정)`)
  return { userId: user.id, name: user.name, role: user.role === "ADMIN" ? "ADMIN" : "MEMBER", ip: null }
}

async function main() {
  const models = pick(MODELS, opt("--models"), (m) => m.key)
  const methods = pick(METHODS, opt("--methods"), (m) => m) as MethodName[]
  // 질문 파일에는 실제 사내 업무가 적혀 있어 저장소 밖(KAKAO_DATA_DIR/eval)에 둔다 — import-tools/eval 과 같은 규칙.
  const qFile = opt("--questions") ?? process.env.BENCH_QUESTIONS ?? `${process.env.KAKAO_DATA_DIR ?? `${process.env.HOME}/work/omnis-import`}/eval/scenarios-260907.json`
  const limit = Number(opt("--limit") ?? 0)
  const doJudge = !flag("--no-judge")
  const questions = loadQuestions(qFile).slice(0, limit > 0 ? limit : undefined)

  if (flag("--list")) {
    for (const m of MODELS) { const a = modelAvailable(m); console.log(`${a.ok ? "○" : "×"} ${m.key.padEnd(28)} ${m.id.padEnd(26)} $${m.price.input}/${m.price.output}${a.ok ? "" : `   (${a.why})`}`) }
    console.log(`방법: ${METHODS.join(", ")}`)
    console.log(`질문 ${questions.length}개 · ${qFile}`)
    return
  }

  const usable = models.filter((m) => { const a = modelAvailable(m); if (!a.ok) console.log(`건너뜀 ${m.key}: ${a.why}`); return a.ok })
  if (usable.length === 0) throw new Error("돌릴 수 있는 모델이 없습니다")
  if (doJudge && !modelAvailable(JUDGE_MODEL).ok) throw new Error("심판 모델 키가 없습니다 (--no-judge 로 끄거나 키를 주세요)")

  const runId = opt("--run") ?? new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/(\d{8})(\d{4})/, "$1-$2")
  const dir = join("bench/results", runId)
  mkdirSync(dir, { recursive: true })
  const outFile = join(dir, "results.jsonl")
  const done = new Set<string>()
  if (existsSync(outFile)) {
    for (const line of readFileSync(outFile, "utf8").split("\n").filter(Boolean)) {
      const r = JSON.parse(line) as ResultRow
      if (!r.error) done.add(`${r.model}|${r.method}|${r.qid}`)
    }
  }

  const dbHost = (process.env.DATABASE_URL ?? "").replace(/.*@/, "").replace(/\/.*/, "")
  const caller = await resolveCaller(opt("--user") ?? "정우창")
  writeFileSync(join(dir, "meta.json"), JSON.stringify({
    runId, startedAt: new Date().toISOString(), dbHost, caller: caller.name, krwPerUsd: KRW_PER_USD,
    models: usable.map((m) => ({ key: m.key, id: m.id, price: m.price, thinking: m.thinking ?? null })),
    methods, questions: qFile, questionCount: questions.length, judge: doJudge ? JUDGE_MODEL.id : null,
  }, null, 2))

  const total = usable.length * methods.length * questions.length
  console.log(`run ${runId} · DB ${dbHost} · ${usable.length} 모델 × ${methods.length} 방법 × ${questions.length} 질문 = ${total} (이미 ${done.size})`)

  let n = 0
  const skipModel = new Set<string>()
  for (const model of usable) {
    for (const method of methods) {
      if (skipModel.has(model.key)) break
      for (const q of questions) {
        n++
        const key = `${model.key}|${method}|${q.id}`
        if (done.has(key)) continue
        const row = await runOne(runId, model, method, q, caller, doJudge)
        appendFileSync(outFile, JSON.stringify(row) + "\n")
        if (row.error && /credit balance|insufficient_quota|billing/i.test(row.error)) {
          // 잔액 소진은 다음 질문도 전부 실패한다. 그 벤더의 남은 칸은 건너뛰고 나중에 --run 으로 이어 돌린다.
          console.log(`  ⚠ ${model.key}: 잔액 소진 — 이 모델의 남은 행은 건너뜀. 충전 후 같은 --run 으로 재개`)
          skipModel.add(model.key)
          break
        }
        const j = row.judge ? ` 심판 ${row.judge.score}${row.judge.hallucination ? "!" : ""}` : ""
        console.log(
          `[${String(n).padStart(3)}/${total}] ${model.key} · ${method} · ${q.id}  근거 ${row.hits.length}/${row.hitTotal}${j}  ${(row.timings.total / 1000).toFixed(1)}s  ${row.costKrw}원` +
          (row.note ? `  · ${row.note}` : "") + (row.error ? `  ✗ ${row.error.slice(0, 80)}` : "")
        )
      }
    }
  }

  await writeReport(dir)
  console.log(`\n결과: ${dir}/summary.md`)
}

async function runOne(runId: string, model: ModelSpec, method: MethodName, q: Question, caller: Caller, doJudge: boolean): Promise<ResultRow> {
  const base = { runId, model: model.key, modelId: model.id, method, qid: q.id, question: q.q, expect: q.expect, hitTotal: q.expect.length, at: new Date().toISOString() }
  let r: MethodResult
  try {
    r = await runMethod(method, model, q.q, caller)
  } catch (err) {
    return { ...base, answer: "", hits: [], judge: null, usage: { input: 0, output: 0, thinking: 0, cached: 0 }, costUsd: 0, costKrw: 0, timings: { retrieval: 0, context: 0, llm: 0, total: 0 }, calls: 0, promptChars: 0, refs: [], error: String(err).slice(0, 500) }
  }
  const usd = costUsd(r.usage, model.price)
  let j: ResultRow["judge"] = null
  if (doJudge && !r.answer && !r.error) {
    j = { score: 0, hallucination: false, reason: "빈 답변", costUsd: 0 }
  } else if (doJudge && r.answer) {
    try {
      const res = await judge(q.q, q.expect, r.answer, r.evidence)
      j = { score: res.score, hallucination: res.hallucination, reason: res.reason, costUsd: res.costUsd }
    } catch (err) {
      j = { score: 0, hallucination: false, reason: `심판 실패: ${String(err).slice(0, 120)}`, costUsd: 0 }
    }
  }
  return {
    ...base,
    answer: r.answer, hits: expectHits(r.answer, q.expect), judge: j,
    usage: r.usage, costUsd: usd, costKrw: usdToKrw(usd),
    timings: { retrieval: Math.round(r.timings.retrieval), context: Math.round(r.timings.context), llm: Math.round(r.timings.llm), total: Math.round(r.timings.total) }, calls: r.calls, promptChars: r.promptChars, refs: r.refs, trace: r.trace, finish: r.finish, note: r.note, error: r.error,
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
